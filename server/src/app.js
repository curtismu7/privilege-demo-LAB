// Pattern from id-jag-standalone server/src/app.js: createApp() for tests, serves web/dist.
// createApp({ cfg, now, jwks }) : cfg defaults to config(); now() is the injectable clock (approval expiry, sessions, trace).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { init } from './cedar/index.js';
import { mockRequestRefusal, adminSwitchPresent } from './auth/guards.js';
import { isAdmin } from './auth/personas.js';
import { getPack, publicPack } from './packs/index.js';
import { createSessions } from './auth/session.js';
import { createPfVerifier } from './auth/pf.js';
import { createBackend } from './mcp/backend.js';
import { createPolicyStore } from './policyStore.js';
import { createApprovals } from './approvals.js';
import { createPep, evaluate, classify, approversOf } from './pep.js';
import { createAudit } from './audit.js';
import { createPreflight } from './preflight.js';
import { createTracer } from './trace/hops.js';
import { createSink, parseTraceparent, newTraceparent } from './trace/index.js';

const WEB_DIST = process.env.WEB_DIST || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApp({ cfg = config(), now = () => Date.now() } = {}) {
  init();
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  app.use(express.json({ limit: '64kb' }));

  const sink = createSink({ size: 500 });
  const tracer = createTracer({ sink, now });
  const audit = createAudit({ dataDir: cfg.dataDir, now });
  const pack = getPack(cfg.pack) ?? getPack('generic'); // personas, agent, tools, schema and shipped policies of the chosen vertical
  const { personas: PERSONAS, agent: AGENT } = pack;
  const backend = createBackend({ tools: pack.tools });
  const store = createPolicyStore({ dataDir: cfg.dataDir, pack });
  const sessions = createSessions({ secret: cfg.sessionSecret, ttlMs: cfg.sessionTtlMs, now });
  const verifyPf = cfg.pfJwksUrl ? createPfVerifier(cfg) : null;
  const approvals = createApprovals({
    now, ttlMs: cfg.approvalTtlMs,
    onExpire(r) {
      const tp = tracer.emit(r.traceparent, { hop: 'approval', subject: r.claims.sub, ...(pack.attribution ? { actor: r.claims.act?.sub ? { sub: r.claims.act.sub } : null, tool: r.tool } : {}), decision: { result: 'deny', rule: 'approval-expired', reason: 'expired without an answer' } }).traceparent;
      r.traceparent = tp;
      audit.write({ kind: 'approval', approval_id: r.id, sub: r.claims.sub, tool: r.tool, approved: false, outcome: 'deny', rule: 'approval-expired', executed: false, trace_id: tp.split('-')[1] });
    },
  });
  const preflight = createPreflight({ cfg, store, now });
  const pep = createPep({ backend, store, approvals, tracer, audit, now, attribution: pack.attribution });

  // ---- authentication: Bearer PF token (live) or signed persona session (mock) ----
  // Returns { ok, claims, source, persona } or { ok:false, status, error, reason }. Emits an auth hop when asked.
  async function authenticate(req, { trace = false, bearerOnly = false } = {}) {
    const incoming = parseTraceparent(req.headers.traceparent) ? req.headers.traceparent : newTraceparent();
    let tp = incoming;
    const emit = (result, rule, reason, claims) => {
      if (trace) ({ traceparent: tp } = tracer.emit(tp, { hop: 'auth', subject: claims?.sub ?? null, actor: claims?.act?.sub ? { sub: claims.act.sub } : null, decision: { result, rule, reason } }));
    };
    const deny = (status, error, reason) => { emit('deny', reason, 'Sign-in check failed'); return { ok: false, status, error, reason, traceparent: tp }; };

    if (req.headers.authorization) {
      if (!verifyPf) return deny(401, 'invalid_token', 'bearer_not_enabled');
      const v = await verifyPf(req.headers.authorization);
      if (!v.ok) return deny(401, 'invalid_token', v.reason);
      emit('allow', 'pf-bearer', 'Token verified against the PingFederate JWKS', v.claims);
      return { ok: true, claims: v.claims, source: 'bearer', traceparent: tp };
    }
    const persona = !bearerOnly && !mockRequestRefusal(req, cfg) ? sessions.read(req.headers.cookie) : null;
    const p = persona && Object.hasOwn(PERSONAS, persona) ? PERSONAS[persona] : null;
    if (p && (!p.admin || adminSwitchPresent(cfg))) {
      emit('allow', 'mock-session', `Persona ${p.name} (offline mock)`, p.claims);
      return { ok: true, claims: p.claims, source: 'session', persona, traceparent: tp };
    }
    return deny(401, 'unauthenticated', 'no_credentials');
  }
  // A 401 that needs configuration says how to fix it (preflight names the rest).
  const unauthorized = (a) => ({ error: a.error, reason: a.reason,
    ...(a.reason === 'bearer_not_enabled' ? { fix: 'This server has no PingFederate configured: set IDP=pf, PF_URL and PF_AUDIENCE and restart (GET /api/preflight lists what is missing).' } : {}) });
  const authed = (opts, handler) => wrap(async (req, res) => {
    const a = await authenticate(req, opts);
    if (!a.ok) return res.status(401).set('www-authenticate', 'Bearer').json(unauthorized(a));
    req.principal = a;
    return handler(req, res);
  });
  const adminOnly = (opts, handler) => authed(opts, (req, res) =>
    (isAdmin(req.principal.claims) ? handler(req, res) : res.status(403).json({ error: 'admin_only' })));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/preflight', wrap(async (_req, res) => res.json(await preflight())));
  app.get('/api/auth/config', (req, res) => res.json({ idp: cfg.idp, mockAvailable: !mockRequestRefusal(req, cfg), bearer: Boolean(verifyPf), pack: publicPack(pack) }));

  // ---- offline mock sign-in: mounted only when IDP=local-mock AND ALLOW_MOCK_SIGNIN=1; every request re-checks the guards ----
  if (cfg.mockSignin) {
    const guard = (req, res, next) => {
      const why = mockRequestRefusal(req, cfg);
      return why ? res.status(403).json({ error: 'mock_signin_refused', reason: why }) : next();
    };
    app.get('/api/auth/mock/personas', guard, (_req, res) => res.json({
      personas: Object.entries(PERSONAS).filter(([, p]) => !p.admin || adminSwitchPresent(cfg)).map(([id, p]) => ({ id, name: p.name, role: p.role, groups: p.claims.groups })),
    }));
    app.post('/api/auth/mock/login', guard, (req, res) => {
      const id = req.body?.persona;
      const p = typeof id === 'string' && Object.hasOwn(PERSONAS, id) ? PERSONAS[id] : null;
      if (!p || (p.admin && !adminSwitchPresent(cfg))) return res.status(404).json({ error: 'not_found' }); // the admin persona does not exist without the switch file
      res.set('set-cookie', sessions.cookie(sessions.issue(id), Math.floor(cfg.sessionTtlMs / 1000)));
      return res.json({ ok: true, persona: id });
    });
  }
  app.post('/api/auth/logout', (_req, res) => { res.set('set-cookie', sessions.cookie('', 0)); res.json({ ok: true }); });

  app.get('/api/me', authed({}, (req, res) => {
    const { claims, source, persona } = req.principal;
    res.json({ sub: claims.sub, groups: claims.groups ?? [], scope: claims.scope ?? '', isAdmin: isAdmin(claims), source, persona: persona ?? null, ...(pack.web && persona ? { name: PERSONAS[persona]?.name } : {}) });
  }));

  app.get('/api/tools', authed({}, (_req, res) => res.json({
    tools: backend.listTools().map((t) => ({ name: t.name, app: t._meta.app, description: t.description, inputSchema: t.inputSchema,
      pinnedHash: backend.pinnedHash(t.name), observedHash: t._meta.schemaHash, drifted: backend.pinnedHash(t.name) !== t._meta.schemaHash,
      ...(backend.isMock(t.name) ? { mock: true } : {}) })),
  })));

  // ---- the PEP, two doors ----
  const STATUS = { allow: 200, hold: 202, deny: 403 };
  const publicOutcome = (o) => { const { traceparent, ...rest } = o; return rest; };

  app.post('/api/tools/call', authed({ trace: true }, (req, res) => {
    const { tool, args, asAgent, justification } = req.body ?? {};
    // asAgent: Mark's personal agent (Dot) makes the call, so the token carries act and the call is unattended.
    const claims = asAgent === true ? { ...req.principal.claims, act: { sub: AGENT.sub } } : req.principal.claims;
    const out = pep.enforce({ claims, tool, args: args ?? {}, source: req.principal.source, traceparent: req.principal.traceparent, justification });
    res.set('traceparent', out.traceparent);
    return res.status(STATUS[out.outcome]).json(publicOutcome(out));
  }));

  app.post('/mcp', wrap(async (req, res) => {
    const a = await authenticate(req, { trace: true, bearerOnly: true }); // MCP is Bearer only
    if (!a.ok) return res.status(401).set('www-authenticate', 'Bearer').json(unauthorized(a));
    const msg = req.body;
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
    if (msg.id === undefined) return res.status(202).end();
    const reply = (body) => res.set('traceparent', a.traceparent).json({ jsonrpc: '2.0', id: msg.id, ...body });
    const handled = backend.rpc(msg);
    if (handled) return reply(handled);
    const params = msg.params ?? {};
    const out = pep.enforce({ claims: a.claims, tool: params.name, args: params.arguments ?? {}, source: 'mcp', traceparent: a.traceparent });
    res.set('traceparent', out.traceparent);
    if (out.outcome === 'allow') return res.json({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(out.result) }] } });
    const code = out.outcome === 'hold' ? -32004 : -32003;
    return res.json({ jsonrpc: '2.0', id: msg.id, error: { code, message: out.outcome === 'hold' ? 'held for approval' : 'denied by policy',
      data: { decision: out.outcome, rule: out.rule, reason: out.reason, rules: out.rules, ...(out.approvalId ? { approvalId: out.approvalId, approvers: out.approvers } : {}) } } });
  }));

  // ---- approvals ----
  const mayDecide = (claims, record) => claims.sub !== record.claims.sub && (isAdmin(claims) || record.approvers.includes(claims.sub));
  const mine = (claims, record) => isAdmin(claims) || record.approvers.includes(claims.sub) || record.claims.sub === claims.sub;

  app.get('/api/approvals', authed({}, (req, res) =>
    res.json({ approvals: approvals.list().filter((r) => mine(req.principal.claims, r)).map(approvals.view) })));
  app.get('/api/approvals/:id', authed({}, (req, res) => {
    const r = approvals.get(req.params.id);
    return r && mine(req.principal.claims, r) ? res.json(approvals.view(r)) : res.status(404).json({ error: 'not_found' });
  }));
  for (const verb of ['approve', 'deny']) {
    app.post(`/api/approvals/:id/${verb}`, authed({ trace: true }, (req, res) => {
      const r = approvals.get(req.params.id);
      if (!r || !mine(req.principal.claims, r)) return res.status(404).json({ error: 'not_found' });
      if (!mayDecide(req.principal.claims, r)) return res.status(403).json({ error: 'not_an_approver' });
      if (r.status !== 'pending') return res.status(409).json({ error: r.status === 'expired' ? 'expired' : 'already_decided', status: r.status });
      pep.resolve(r, { sub: req.principal.claims.sub }, verb === 'approve');
      return res.json(approvals.view(r));
    }));
  }

  // ---- policies (admin) ----
  const problemsOut = (problems) => problems.map((p) => ({ policyId: p.policyId ?? null, message: p.message }));
  app.get('/api/policies', authed({}, (_req, res) => res.json({ policies: store.list(), error: store.activeError() ? problemsOut(store.activeError()) : null })));
  app.post('/api/policies/validate', adminOnly({}, (req, res) => {
    const { policies, id, text } = req.body ?? {};
    let map = policies;
    if (map === undefined && typeof id === 'string' && typeof text === 'string') {
      map = Object.fromEntries([...store.list().filter((p) => p.state === 'active' && p.id !== id).map((p) => [p.id, p.text]), [id, text]]);
    }
    const v = store.validate(map);
    res.json({ ok: v.ok, problems: problemsOut(v.problems) });
  }));
  app.put('/api/policies/:id', adminOnly({}, (req, res) => {
    const { text, state = 'active' } = req.body ?? {};
    if (typeof text !== 'string') return res.status(400).json({ error: 'text_required' });
    const r = store.put(req.params.id, text, state);
    audit.write({ kind: 'policy_put', sub: req.principal.claims.sub, policy: req.params.id, state, ok: r.ok });
    return r.ok ? res.json({ ok: true }) : res.status(422).json({ ok: false, problems: problemsOut(r.problems) });
  }));
  app.delete('/api/policies/:id', adminOnly({}, (req, res) => {
    const state = req.query.state === 'candidate' ? 'candidate' : 'active';
    const r = store.remove(req.params.id, state);
    audit.write({ kind: 'policy_delete', sub: req.principal.claims.sub, policy: String(req.params.id).slice(0, 100), state, ok: r.ok });
    if (r.notFound) return res.status(404).json({ error: 'not_found' });
    return r.ok ? res.json({ ok: true }) : res.status(422).json({ ok: false, problems: problemsOut(r.problems) });
  }));

  // Synthetic request -> full decision, plus what the staged Candidate policies would change. Runs nothing, holds nothing.
  app.post('/api/decide-test', authed({}, (req, res) => {
    const { claims, tool, args = {}, approvalCount = 0, drift = false } = req.body ?? {};
    const def = typeof tool === 'string' ? backend.tool(tool) : null;
    if (!def) return res.status(400).json({ error: 'unknown_tool', tools: backend.names() });
    if (!Number.isSafeInteger(approvalCount) || approvalCount < 0 || approvalCount > 100) return res.status(400).json({ error: 'bad_approval_count' });
    const common = { claims, tool, app: def.app, args, approvalCount, pinnedHash: backend.pinnedHash(tool), observedHash: drift === true ? 'drifted' : backend.observedHash(tool), resource: backend.resourceAttrs(tool, args) };
    const shape = (policySet) => {
      const d = evaluate({ policySet, ...common });
      return { outcome: classify(d, policySet), decision: d.decision, rule: d.rule, rules: d.rules, overridden: d.overridden, reason: d.reason, problems: d.problems,
        approvers: [...new Set(d.rules.flatMap((r) => approversOf(policySet, r)))] };
    };
    const active = shape(store.activeSet());
    const cand = store.candidateSet();
    const shadow = cand ? { candidates: cand.ids, active: { outcome: active.outcome, rule: active.rule }, candidate: shape(cand.policySet) } : null;
    if (shadow) shadow.changed = shadow.candidate.outcome !== active.outcome || shadow.candidate.rule !== active.rule;
    res.json({ ...active, shadow });
  }));

  // ---- demo controls (admin) ----
  app.post('/api/admin/drift', adminOnly({}, (req, res) => {
    const { tool, on } = req.body ?? {};
    return typeof tool === 'string' && typeof on === 'boolean' && backend.setDrift(tool, on) ? res.json({ ok: true, drifted: backend.driftedTools() }) : res.status(400).json({ error: 'bad_request' });
  }));
  app.post('/api/reset', adminOnly({}, (req, res) => {
    store.reset(); approvals.clear(); backend.resetDrift(); sink.clear();
    audit.write({ kind: 'reset', sub: req.principal.claims.sub });
    res.json({ ok: true });
  }));

  app.get('/api/trace', authed({}, (req, res) => res.json({ events: sink.list({ trace_id: typeof req.query.trace_id === 'string' ? req.query.trace_id : undefined }) })));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get('*', (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  // Never echo the request body or headers: a malformed body is just a 400.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    console.error(`[privilege-demo] request failed (${err?.name || 'error'})`);
    return res.status(500).json({ error: 'internal_error' });
  });
  return app;
}

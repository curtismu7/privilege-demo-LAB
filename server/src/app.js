// Pattern from id-jag-standalone server/src/app.js: createApp() for tests, serves web/dist.
// createApp({ cfg, now, fetchImpl, customerFile }) : cfg defaults to config(); now() is the injectable clock (approval expiry, sessions, trace);
// fetchImpl is the real fetch behind the netguard (tests pass a stub that must never be called in mock mode).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config, liveProblems } from './config.js';
import { init } from './cedar/index.js';
import { mockRequestRefusal, localRequestRefusal, hostAllowed, adminSwitchPresent } from './auth/guards.js';
import { isAdmin } from './auth/personas.js';
import { getPack, publicPack } from './packs/index.js';
import { createSessions } from './auth/session.js';
import { createPfVerifier, createVerifier } from './auth/pf.js';
import { createPiFlowLogin } from './auth/piflowLogin.js';
import { createMockIdp } from './mockIdp.js';
import { createNetguard } from './netguard.js';
import { loadCustomerConfig, publicConfig } from './customer.js';
import { createWorkspaces, validWorkspace, WorkspaceError, DEFAULT_WORKSPACE, WORKSPACE_HEADER } from './workspaces.js';
import { createBackend } from './mcp/backend.js';
import { createPolicyStore } from './policyStore.js';
import { createApprovals } from './approvals.js';
import { createPep, evaluate, classify, approversOf } from './pep.js';
import { createAudit } from './audit.js';
import { createPreflight } from './preflight.js';
import { createTracer } from './trace/hops.js';
import { createSink, parseTraceparent, newTraceparent } from './trace/index.js';
import { createExplainer, createExplanationStore } from './explain/index.js';
import { shelfInfo } from './shelfLink.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WEB_DIST = process.env.WEB_DIST || path.join(ROOT, 'web/dist');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export const DEMO = (() => {
  let version = '0.0.0';
  try { version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { /* keep the default */ }
  return { id: 'privilege-demo', name: 'Privilege demo LAB', version };
})();

export function createApp({ cfg = config(), now = () => Date.now(), fetchImpl = globalThis.fetch, customerFile } = {}) {
  init();
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

  // ---- mode: mock (default, all in process) or live (Bearer tokens from the configured PingFederate). The page toggles it. ----
  let currentMode = cfg.idp === 'pf' ? 'live' : 'mock';
  const mode = () => currentMode;
  const liveReady = () => liveProblems(cfg).length === 0;

  const pack = getPack(cfg.pack) ?? getPack('generic'); // personas, agent, tools, schema and shipped policies of the chosen vertical
  const { personas: PERSONAS, agent: AGENT } = pack;
  const customer = loadCustomerConfig({ file: customerFile });
  app.locals.customerWarnings = customer.warnings;
  // The plain-English "why" of decisions and policies (explain/). Stateless; it only reads the policy set it is handed.
  const explainer = createExplainer({ pack, customer, mode });

  // The netguard is the only door out: nothing leaves the process in mock mode; live mode reaches only the configured PingFederate.
  const netguard = createNetguard({ mode, liveOrigin: () => { try { return new URL(cfg.pfJwksUrl || cfg.pfUrl).origin; } catch { return null; } }, realFetch: fetchImpl });
  app.locals.netguard = netguard; // tests and the doctor read its counters
  const mockIdp = createMockIdp({ now, personas: PERSONAS, agent: AGENT });
  const verifyMock = createVerifier({ keySource: mockIdp.publicKey, issuer: mockIdp.issuer, audience: mockIdp.audience, clockSkewSec: cfg.clockSkewSec });
  const verifyPf = cfg.pfJwksUrl ? createPfVerifier(cfg, { fetchImpl: netguard.fetchImpl }) : null;
  const liveLogin = mode() === 'live' || cfg.pfAuthClientId ? createPiFlowLogin({ cfg, fetchImpl: netguard.fetchImpl, now }) : null;

  const sessions = createSessions({ secret: cfg.sessionSecret, ttlMs: cfg.sessionTtlMs, now });
  // Live sign-in runs (pi.flow), one in flight per workspace: the flow id is a bearer handle and stays here.
  const loginRuns = new Map();
  const preflight = createPreflight({ cfg, mode, now, fetchImpl: netguard.fetchImpl });

  // ---- workspaces: one policy store, approval queue, drift state, trace buffer and audit log each ----
  const workspaces = createWorkspaces({
    build(id) {
      const dir = id === DEFAULT_WORKSPACE ? cfg.dataDir : path.join(cfg.dataDir, 'workspaces', id);
      const sink = createSink({ size: 500 });
      const tracer = createTracer({ sink, now });
      const audit = createAudit({ dataDir: dir, now });
      const backend = createBackend({ tools: pack.tools });
      const explanations = createExplanationStore({ size: 500 });
      const store = createPolicyStore({ dataDir: dir, pack });
      const approvals = createApprovals({
        now, ttlMs: cfg.approvalTtlMs,
        onExpire(r) {
          const tp = tracer.emit(r.traceparent, { hop: 'approval', subject: r.claims.sub, ...(pack.attribution ? { actor: r.claims.act?.sub ? { sub: r.claims.act.sub } : null, tool: r.tool } : {}), decision: { result: 'deny', rule: 'approval-expired', reason: 'expired without an answer' } }).traceparent;
          r.traceparent = tp;
          try {
            const explanation = explainer.forAnswer({ status: 'expired', claims: r.claims, tool: r.tool, app: r.app, args: r.args, approverSubs: r.approvers });
            r.outcome.explanation = explanation;
            explanations.put(tp.split('-')[2], explanation);
          } catch { /* an explanation must not break the queue */ }
          audit.write({ kind: 'approval', approval_id: r.id, sub: r.claims.sub, tool: r.tool, approved: false, outcome: 'deny', rule: 'approval-expired', executed: false, trace_id: tp.split('-')[1] });
        },
      });
      const pep = createPep({ backend, store, approvals, tracer, audit, now, attribution: pack.attribution, explainer, explanations });
      return { id, dir, sink, tracer, audit, backend, store, approvals, pep, explanations };
    },
    // Run state of one workspace: policies back to the shipped set, no approvals, no drift, an empty trace. Sign-ins and settings stay.
    reset(ws) {
      const cleared = { approvals: ws.approvals.list().length, traceEvents: ws.sink.list().length, driftedTools: ws.backend.driftedTools().length };
      ws.store.reset(); ws.approvals.clear(); ws.backend.resetDrift(); ws.sink.clear(); ws.explanations.clear();
      ws.audit.write({ kind: 'reset' });
      return { workspace: ws.id, cleared };
    },
  });
  app.locals.workspaces = workspaces;
  workspaces.get(DEFAULT_WORKSPACE); // the default workspace exists from the start (its policies are on disk, and the health route can see them)
  const wsOf = (req) => workspaces.get(req.workspaceId);

  // ---- headers, Host check, workspace id, same-origin writes ----
  app.use((_req, res, next) => {
    res.set({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP });
    next();
  });
  // Only the names this app answers to (loopback, plus LAB_ALLOWED_HOSTS): a rebound DNS name gets nothing, not even the health route.
  app.use((req, res, next) => (hostAllowed(req.headers.host, cfg) ? next() : res.status(403).json({ error: 'host_not_allowed' })));

  // GET only, no detail (rule 15). The state is ready unless live mode is chosen and not configured, or a policy set is broken.
  app.get('/api/health', (_req, res) => {
    const broken = workspaces.ids().some((id) => workspaces.peek(id).store.activeError());
    const needsSetup = mode() === 'live' && !liveReady();
    res.set('Cache-Control', 'no-store').json({
      schema: 'demo-health/1', at: new Date(now()).toISOString(), state: broken ? 'broken' : needsSetup ? 'needs-setup' : 'ready',
      runtime: mode() === 'mock' ? 'offline' : 'live', demo: DEMO,
    });
  });

  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.path.startsWith('/api') && req.path !== '/mcp') return next();
    const id = req.headers[WORKSPACE_HEADER] ?? DEFAULT_WORKSPACE;
    if (!validWorkspace(id)) return res.status(400).json({ error: 'bad_workspace', fix: 'The workspace id is lowercase letters, digits and hyphens (1 to 32 characters).' });
    req.workspaceId = id;
    return next();
  });

  // A write must come from this app's own pages: a browser sends Origin on a cross-site write, and it must match the Host it reached.
  // Agents and curl send no Origin and are not browsers, so they pass. A body must be JSON (a cross-site form cannot send that unprompted).
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const { origin } = req.headers;
    const site = req.headers['sec-fetch-site'];
    let originHost = null;
    if (origin) { try { originHost = new URL(origin).host; } catch { originHost = '?'; } }
    if ((originHost && originHost !== req.headers.host) || (site && site !== 'same-origin' && site !== 'none')) return res.status(403).json({ error: 'cross_origin_write_refused' });
    const hasBody = req.headers['content-length'] && req.headers['content-length'] !== '0';
    if (hasBody && !String(req.headers['content-type'] || '').startsWith('application/json')) return res.status(415).json({ error: 'json_required' });
    return next();
  });
  app.use(express.json({ limit: '64kb' }));

  // ---- authentication: Bearer token (live: PingFederate, mock: the in-process mock issuer) or signed persona session (mock) ----
  const mockRefusal = (req) => mockRequestRefusal(req, cfg, mode());
  // Returns { ok, claims, source, persona } or { ok:false, status, error, reason }. Emits an auth hop when asked.
  async function authenticate(req, { trace = false, bearerOnly = false } = {}) {
    const ws = wsOf(req);
    const incoming = parseTraceparent(req.headers.traceparent) ? req.headers.traceparent : newTraceparent();
    let tp = incoming;
    const emit = (result, rule, reason, claims) => {
      if (trace) ({ traceparent: tp } = ws.tracer.emit(tp, { hop: 'auth', subject: claims?.sub ?? null, actor: claims?.act?.sub ? { sub: claims.act.sub } : null, decision: { result, rule, reason } }));
    };
    const deny = (status, error, reason) => { emit('deny', reason, 'Sign-in check failed'); return { ok: false, status, error, reason, traceparent: tp }; };

    if (req.headers.authorization) {
      const live = mode() === 'live';
      const verify = live ? verifyPf : verifyMock;
      if (!verify) return deny(401, 'invalid_token', 'bearer_not_enabled');
      const v = await verify(req.headers.authorization);
      if (!v.ok) return deny(401, 'invalid_token', v.reason);
      emit('allow', live ? 'pf-bearer' : 'mock-bearer', live ? 'Token verified against the PingFederate JWKS' : 'Mock token verified against the in-process mock issuer (mock)', v.claims);
      return { ok: true, claims: v.claims, source: 'bearer', traceparent: tp };
    }
    const who = !bearerOnly ? sessions.readAny(req.headers.cookie, ws.id) : null;
    if (who && typeof who === 'object' && who.claims) {
      emit('allow', 'live-session', 'Verified at sign-in against the PingFederate JWKS (live pi.flow sign-in)', who.claims);
      return { ok: true, claims: who.claims, source: 'session', traceparent: tp };
    }
    const persona = typeof who === 'string' && !mockRefusal(req) ? who : null;
    const p = persona && Object.hasOwn(PERSONAS, persona) ? PERSONAS[persona] : null;
    if (p && (!p.admin || adminSwitchPresent(cfg))) {
      emit('allow', 'mock-session', `Persona ${p.name} (offline mock)`, p.claims);
      return { ok: true, claims: p.claims, source: 'session', persona, traceparent: tp };
    }
    return deny(401, 'unauthenticated', 'no_credentials');
  }
  // A 401 that needs configuration says how to fix it (preflight names the rest).
  const unauthorized = (a) => ({ error: a.error, reason: a.reason,
    ...(a.reason === 'bearer_not_enabled' ? { fix: 'This server has no PingFederate configured: set PF_URL and PF_AUDIENCE in ~/Development/.env and restart (GET /api/preflight lists what is missing).' } : {}) });
  const authed = (opts, handler) => wrap(async (req, res) => {
    const a = await authenticate(req, opts);
    if (!a.ok) return res.status(401).set('www-authenticate', 'Bearer').json(unauthorized(a));
    req.principal = a;
    return handler(req, res);
  });
  const adminOnly = (opts, handler) => authed(opts, (req, res) =>
    (isAdmin(req.principal.claims) ? handler(req, res) : res.status(403).json({ error: 'admin_only' })));

  // ---- mode, config, preflight ----
  const liveFix = () => {
    const problems = liveProblems(cfg);
    if (problems.length === 0) return {};
    // Names what is missing. In Docker the container only sees the shared file through the compose overlay.
    return { liveFix: `Live mode still needs: ${problems.join('; ')}. Set PF_URL, PF_AUDIENCE and the sign-in client (PF_AUTH_CLIENT_ID, PF_AUTH_CLIENT_SECRET, PF_AUTH_REDIRECT_URI) in ~/Development/.env (or the file STANDALONE_ENV names), then restart. In Docker also start with the overlay: docker compose -f docker-compose.yml -f docker-compose.shared-env.yml up -d. Mock mode needs nothing.` };
  };
  const modeView = (req) => ({
    mode: mode(), liveReady: liveReady(),
    ...liveFix(),
    mockSignIn: { allowed: !mockRequestRefusal(req, cfg, 'mock'), refusal: mockRequestRefusal(req, cfg, 'mock') },
  });
  app.get('/api/mode', (req, res) => res.json(modeView(req)));
  app.put('/api/mode', (req, res) => {
    const refusal = localRequestRefusal(req, cfg);
    if (refusal) return res.status(403).json({ error: 'mode_change_refused', reason: refusal });
    const next = req.body?.mode;
    if (next !== 'mock' && next !== 'live') return res.status(400).json({ error: 'bad_mode', fix: 'mode is mock or live' });
    if (next === 'live' && !liveReady()) return res.status(409).json({ error: 'live_not_configured', ...modeView(req) });
    currentMode = next;
    return res.json(modeView(req));
  });
  app.get('/api/preflight', wrap(async (req, res) => res.json(await preflight(wsOf(req).store))));
  app.get('/api/auth/config', (req, res) => res.json({
    idp: mode() === 'live' ? 'pf' : 'local-mock', mode: mode(), liveReady: liveReady(), ...liveFix(), workspace: req.workspaceId,
    mockAvailable: !mockRefusal(req), mockRefusal: mockRefusal(req), bearer: mode() === 'live' ? Boolean(verifyPf) : true, pack: publicPack(pack),
    liveSignin: mode() === 'live' && liveReady() && Boolean(cfg.pfAuthClientId),
    customer: publicConfig(customer),
  }));

  // ---- offline mock sign-in: mounted only when ALLOW_MOCK_SIGNIN=1; every request re-checks the guards (loopback, no proxy, mock mode) ----
  if (cfg.mockSignin) {
    const guard = (req, res, next) => {
      const why = mockRefusal(req);
      return why ? res.status(403).json({ error: 'mock_signin_refused', reason: why }) : next();
    };
    app.get('/api/auth/mock/personas', guard, (_req, res) => res.json({
      personas: Object.entries(PERSONAS).filter(([, p]) => !p.admin || adminSwitchPresent(cfg)).map(([id, p]) => ({ id, name: p.name, role: p.role, groups: p.claims.groups })),
    }));
    app.post('/api/auth/mock/login', guard, (req, res) => {
      const id = req.body?.persona;
      const p = typeof id === 'string' && Object.hasOwn(PERSONAS, id) ? PERSONAS[id] : null;
      if (!p || (p.admin && !adminSwitchPresent(cfg))) return res.status(404).json({ error: 'not_found' }); // the admin persona does not exist without the switch file
      res.set('set-cookie', sessions.cookie(sessions.issue(id, req.workspaceId), Math.floor(cfg.sessionTtlMs / 1000), req.workspaceId));
      return res.json({ ok: true, persona: id });
    });
    // A mock access token for the signed-in persona, so the /mcp door can be tried offline. Shown whole and labelled mock (rule 4).
    app.post('/api/mock/token', guard, authed({}, async (req, res) => {
      const { persona } = req.principal;
      if (!persona) return res.status(409).json({ error: 'persona_session_required' });
      const asAgent = req.body?.asAgent === true;
      const token = await mockIdp.mint({ persona, ...(asAgent ? { act: AGENT.sub } : {}) });
      res.json({ mock: true, label: 'mock token: signed by the in-process mock issuer, not by PingFederate', access_token: token, expires_in: 600, audience: mockIdp.audience, issuer: mockIdp.issuer });
    }));
  }
  const meView = ({ claims, source, persona }) => ({ sub: claims.sub, groups: claims.groups ?? [], scope: claims.scope ?? '', isAdmin: isAdmin(claims), source, persona: persona ?? null, ...(pack.web && persona ? { name: PERSONAS[persona]?.name } : {}) });
  // ---- live sign-in (pi.flow, live mode only): a real PingFederate login that signs the same persona session ----
  const liveSigninOk = (req, res) => {
    if (mode() !== 'live') { res.status(403).json({ error: 'mock_only_feature', reason: 'The pi.flow sign-in runs in live mode. Switch to Live, or use the persona picker in Mock.' }); return false; }
    if (!liveReady() || !cfg.pfAuthClientId) { res.status(409).json({ error: 'live_not_configured', liveFix: liveFix().liveFix }); return false; }
    return true;
  };
  app.post('/api/auth/live/start', wrap(async (req, res) => {
    if (!liveSigninOk(req, res)) return;
    const run = await liveLogin.start();
    loginRuns.set(req.workspaceId, run);
    res.json({ ok: true, status: run.status });
  }));
  app.post('/api/auth/live/credentials', wrap(async (req, res) => {
    if (!liveSigninOk(req, res)) return;
    const run = loginRuns.get(req.workspaceId);
    try {
      const tokens = await liveLogin.submit(run, { username: req.body?.username, password: req.body?.password });
      // The access token is verified exactly as a Bearer token would be, so the session carries only verified claims.
      const v = verifyPf ? await verifyPf(`Bearer ${tokens.accessToken}`) : { ok: false, reason: 'pf_not_configured' };
      if (!v.ok) return res.status(401).json({ error: 'token_invalid', reason: v.reason });
      const sub = String(v.claims.sub ?? '');
      loginRuns.delete(req.workspaceId);
      res.set('set-cookie', sessions.cookie(sessions.issueClaims(v.claims, req.workspaceId), Math.floor(cfg.sessionTtlMs / 1000), req.workspaceId));
      return res.json({ ok: true, me: meView({ claims: v.claims, source: 'bearer' }) });
    } catch (e) {
      const status = e.status || 502;
      if (status >= 500 || status === 401) loginRuns.delete(req.workspaceId);
      return res.status(status).json({ error: e.code || 'signin_failed', reason: e.message, ...(e.detail ? { detail: e.detail } : {}) });
    }
  }));
  app.post('/api/auth/logout', (req, res) => { res.set('set-cookie', sessions.cookie('', 0, req.workspaceId)); res.json({ ok: true }); });

  app.get('/api/me', authed({}, (req, res) => res.json(meView(req.principal))));
  // The same answer for the web app, but "nobody is signed in" is a normal 200 with me: null, so the browser console stays clean.
  app.get('/api/session', wrap(async (req, res) => {
    const a = await authenticate(req, {});
    res.json({ me: a.ok ? meView(a) : null });
  }));

  app.get('/api/tools', authed({}, (req, res) => {
    const { backend } = wsOf(req);
    res.json({
      tools: backend.listTools().map((t) => ({ name: t.name, app: t._meta.app, description: t.description, inputSchema: t.inputSchema,
        pinnedHash: backend.pinnedHash(t.name), observedHash: t._meta.schemaHash, drifted: backend.pinnedHash(t.name) !== t._meta.schemaHash,
        ...(backend.isMock(t.name) ? { mock: true } : {}) })),
    });
  }));

  // ---- the PEP, two doors ----
  const STATUS = { allow: 200, hold: 202, deny: 403 };
  const publicOutcome = (o) => { const { traceparent, ...rest } = o; return rest; };

  app.post('/api/tools/call', authed({ trace: true }, (req, res) => {
    const { tool, args, asAgent, justification } = req.body ?? {};
    // asAgent: Mark's personal agent (Dot) makes the call, so the token carries act and the call is unattended.
    const claims = asAgent === true ? { ...req.principal.claims, act: { sub: AGENT.sub } } : req.principal.claims;
    const out = wsOf(req).pep.enforce({ claims, tool, args: args ?? {}, source: req.principal.source, traceparent: req.principal.traceparent, justification });
    res.set('traceparent', out.traceparent);
    // ?envelope=1 (the web console): always 200 with the outcome in the body, because a Deny is a result and not a failed request.
    return res.status(req.query.envelope === '1' ? 200 : STATUS[out.outcome]).json(publicOutcome(out));
  }));

  app.post('/mcp', wrap(async (req, res) => {
    const a = await authenticate(req, { trace: true, bearerOnly: true }); // MCP is Bearer only
    if (!a.ok) return res.status(401).set('www-authenticate', 'Bearer').json(unauthorized(a));
    const { backend, pep } = wsOf(req);
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

  app.get('/api/approvals', authed({}, (req, res) => {
    const { approvals } = wsOf(req);
    res.json({ approvals: approvals.list().filter((r) => mine(req.principal.claims, r)).map(approvals.view) });
  }));
  app.get('/api/approvals/:id', authed({}, (req, res) => {
    const { approvals } = wsOf(req);
    const r = approvals.get(req.params.id);
    return r && mine(req.principal.claims, r) ? res.json(approvals.view(r)) : res.status(404).json({ error: 'not_found' });
  }));
  for (const verb of ['approve', 'deny']) {
    app.post(`/api/approvals/:id/${verb}`, authed({ trace: true }, (req, res) => {
      const { approvals, pep } = wsOf(req);
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
  app.get('/api/policies', authed({}, (req, res) => {
    const { store } = wsOf(req);
    // `meaning` is computed from each row's saved text on every request, so it always follows an edit.
    res.json({ policies: store.list().map((p) => ({ ...p, meaning: explainer.meaning(p) })), error: store.activeError() ? problemsOut(store.activeError()) : null });
  }));
  // The meaning of unsaved editor text (a preview). Problems come back as a normal 200 so typing does not fill the console with errors.
  app.post('/api/policies/explain', adminOnly({}, (req, res) => {
    const { store } = wsOf(req);
    const { id, text, state = 'active' } = req.body ?? {};
    if (typeof id !== 'string' || typeof text !== 'string') return res.status(400).json({ error: 'id_and_text_required' });
    const v = store.validate({ [id]: text });
    if (!v.ok) return res.json({ ok: false, problems: problemsOut(v.problems) });
    return res.json({ ok: true, meaning: explainer.meaning({ id, state: state === 'candidate' ? 'candidate' : 'active', text }) });
  }));
  app.post('/api/policies/validate', adminOnly({}, (req, res) => {
    const { store } = wsOf(req);
    const { policies, id, text } = req.body ?? {};
    let map = policies;
    if (map === undefined && typeof id === 'string' && typeof text === 'string') {
      map = Object.fromEntries([...store.list().filter((p) => p.state === 'active' && p.id !== id).map((p) => [p.id, p.text]), [id, text]]);
    }
    const v = store.validate(map);
    res.json({ ok: v.ok, problems: problemsOut(v.problems) });
  }));
  app.put('/api/policies/:id', adminOnly({}, (req, res) => {
    const { store, audit } = wsOf(req);
    const { text, state = 'active' } = req.body ?? {};
    if (typeof text !== 'string') return res.status(400).json({ error: 'text_required' });
    const r = store.put(req.params.id, text, state);
    audit.write({ kind: 'policy_put', sub: req.principal.claims.sub, policy: req.params.id, state, ok: r.ok });
    return r.ok ? res.json({ ok: true }) : res.status(422).json({ ok: false, problems: problemsOut(r.problems) });
  }));
  app.delete('/api/policies/:id', adminOnly({}, (req, res) => {
    const { store, audit } = wsOf(req);
    const state = req.query.state === 'candidate' ? 'candidate' : 'active';
    const r = store.remove(req.params.id, state);
    audit.write({ kind: 'policy_delete', sub: req.principal.claims.sub, policy: String(req.params.id).slice(0, 100), state, ok: r.ok });
    if (r.notFound) return res.status(404).json({ error: 'not_found' });
    return r.ok ? res.json({ ok: true }) : res.status(422).json({ ok: false, problems: problemsOut(r.problems) });
  }));

  // Synthetic request -> full decision, plus what the staged Candidate policies would change. Runs nothing, holds nothing.
  app.post('/api/decide-test', authed({}, (req, res) => {
    const { store, backend } = wsOf(req);
    const { claims, tool, args = {}, approvalCount = 0, drift = false, explain = false } = req.body ?? {};
    const def = typeof tool === 'string' ? backend.tool(tool) : null;
    if (!def) return res.status(400).json({ error: 'unknown_tool', tools: backend.names() });
    if (!Number.isSafeInteger(approvalCount) || approvalCount < 0 || approvalCount > 100) return res.status(400).json({ error: 'bad_approval_count' });
    const common = { claims, tool, app: def.app, args, approvalCount, pinnedHash: backend.pinnedHash(tool), observedHash: drift === true ? 'drifted' : backend.observedHash(tool), resource: backend.resourceAttrs(tool, args) };
    const shape = (policySet) => {
      const d = evaluate({ policySet, ...common });
      // Same rule as the console: a hold only counts if an approval could end in allow, otherwise it is a plain deny.
      const kind = classify(d, policySet);
      const approvable = kind === 'hold' && evaluate({ policySet, ...common, approvalCount: Math.max(approvalCount, 1) }).decision === 'allow';
      const outcome = kind === 'hold' && !approvable ? 'deny' : kind;
      return { outcome, decision: d.decision, rule: d.rule, rules: d.rules, overridden: d.overridden, reason: d.reason, problems: d.problems,
        approvers: outcome === 'hold' ? [...new Set(d.rules.flatMap((r) => approversOf(policySet, r)))] : [] };
    };
    const active = shape(store.activeSet());
    const cand = store.candidateSet();
    const shadow = cand ? { candidates: cand.ids, active: { outcome: active.outcome, rule: active.rule }, candidate: shape(cand.policySet) } : null;
    if (shadow) shadow.changed = shadow.candidate.outcome !== active.outcome || shadow.candidate.rule !== active.rule;
    // explain:true adds the plain-English "why". Off by default: the group x tool grid asks for dozens of decisions at once.
    // `outcome` above is what the console would answer too (a hold only if an approval could lead to allow).
    const explanation = explain === true && store.activeSet() ? explainer.forCall({ policySet: store.activeSet(), ...common, source: 'test' }) : undefined;
    res.json({ ...active, shadow, ...(explanation ? { explanation } : {}) });
  }));

  // ---- demo controls ----
  app.post('/api/admin/drift', adminOnly({}, (req, res) => {
    const { backend } = wsOf(req);
    const { tool, on } = req.body ?? {};
    return typeof tool === 'string' && typeof on === 'boolean' && backend.setDrift(tool, on) ? res.json({ ok: true, drifted: backend.driftedTools() }) : res.status(400).json({ error: 'bad_request' });
  }));
  // Reset (rule 3, 13): the current workspace only. Policies back to the shipped set, approvals, drift and trace cleared; sign-ins stay.
  app.post('/api/reset', adminOnly({}, (req, res) => res.json({ ok: true, ...workspaces.reset(req.workspaceId) })));
  // The same reset for `npm run reset`, which has no sign-in: allowed from this machine only (loopback, no proxy), or for an admin.
  app.post('/api/workspaces/:workspace/reset', wrap(async (req, res) => {
    if (!validWorkspace(req.params.workspace)) return res.status(400).json({ error: 'bad_workspace' });
    if (localRequestRefusal(req, cfg)) {
      const a = await authenticate(req);
      if (!a.ok || !isAdmin(a.claims)) return res.status(403).json({ error: 'reset_refused', fix: 'Run npm run reset on the machine that runs the app, or sign in as an admin.' });
    }
    return res.json({ ok: true, ...workspaces.reset(req.params.workspace) });
  }));

  // The events are untouched (the envelope has no explanation field); the plain-English "why" of the pep and approval hops rides beside them, keyed by span id.
  app.get('/api/trace', authed({}, (req, res) => {
    const ws = wsOf(req);
    const events = ws.sink.list({ trace_id: typeof req.query.trace_id === 'string' ? req.query.trace_id : undefined });
    // The explanation carries amounts, groups and scopes, so it is shown only to the people /api/approvals shows the same call to:
    // the requester, a named approver and an admin.
    const me = req.principal.claims;
    const visible = new Set(ws.approvals.list().filter((r) => mine(me, r)).map((r) => String(r.traceparent).split('-')[1]));
    const explanations = {};
    for (const e of events) {
      const x = e.hop === 'pep' || e.hop === 'approval' ? ws.explanations.get(e.span_id) : null;
      const seen = isAdmin(me) || e.subject === me.sub || visible.has(e.trace_id);
      if (x && seen) explanations[e.span_id] = x;
    }
    res.json({ events, explanations });
  }));

  // The header "Shelf" button. Before the /api 404 below, and not tied to a web build.
  app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get('*', (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  // Never echo the request body or headers: a malformed body is just a 400.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof WorkspaceError) return res.status(err.status).json({ error: err.code });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    console.error(`[privilege-demo] request failed (${err?.name || 'error'})`);
    return res.status(500).json({ error: 'internal_error' });
  });
  return app;
}

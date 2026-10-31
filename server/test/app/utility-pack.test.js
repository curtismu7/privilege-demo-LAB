// The utility / NERC CIP-style pack through the real app: PEP, approvals, trace attribution and the /mcp door. Groups are INVENTED, backends are MOCKS.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStubIssuer } from '../../../stub-issuer/server.mjs';
import { config, startupProblems } from '../../src/config.js';
import { getPack } from '../../src/packs/index.js';
import { validateEvent } from '../../src/trace/index.js';
import { makeApp, mockApp, signedIn, pfApp, startStubPf, rpc, bearer, tmpDir } from './helpers.js';

const U = { pack: 'utility' };
const call = (agent, tool, args, extra = { asAgent: true }) => agent.post('/api/tools/call').send({ tool, args, ...extra });
const OPS = { repo: 'grid-ops-portal', pr: 42 };

async function world() {
  const ctx = mockApp(U);
  const who = {};
  for (const p of ['eli', 'gwen', 'ben', 'cora', 'priya', 'dana']) who[p] = await signedIn(ctx, p);
  return { ctx, ...who };
}

describe('pack selection', () => {
  it('the default pack is the original demo: same personas, same four tools, no mock labels, no attribution fields', async () => {
    const ctx = mockApp();
    expect(ctx.cfg.pack).toBe('generic');
    expect((await request(ctx.app).get('/api/auth/mock/personas')).body.personas.map((p) => p.id)).toEqual(['mark', 'mary', 'priya']);
    const mary = await signedIn(ctx, 'mary');
    const tools = (await mary.get('/api/tools')).body.tools;
    expect(tools.map((t) => t.name)).toEqual(['search_flights', 'create_ticket', 'pay_invoice', 'book_fare']);
    expect(tools.some((t) => t.mock)).toBe(false);
    const r = await call(mary, 'search_flights', { query: 'x' }, {});
    expect(r.body.attribution).toBeUndefined();
    const ev = (await mary.get('/api/trace')).body.events;
    expect(ev.some((e) => 'tool' in e)).toBe(false);
    expect((await request(ctx.app).get('/api/auth/config')).body.pack).toEqual({ id: 'generic', label: expect.any(String) });
    expect((await mary.get('/api/me')).body.name).toBeUndefined();
  });

  it('an unknown PACK stops startup and names the setting', () => {
    expect(startupProblems({ ...config(), pack: 'nope', idp: 'local-mock', mockSignin: false })).toEqual(expect.arrayContaining([expect.stringMatching(/^PACK must be one of generic, utility/)]));
    expect(startupProblems({ ...config(), pack: 'utility', mockSignin: false })).toEqual([]);
  });

  it('utility lists its own people (Dana only with the admin switch) and its own tools, all labelled mock', async () => {
    const ctx = mockApp(U);
    expect((await request(ctx.app).get('/api/auth/mock/personas')).body.personas.map((p) => p.id)).toEqual(['eli', 'gwen', 'ben', 'cora', 'priya']);
    const eli = await signedIn(ctx, 'eli');
    const tools = (await eli.get('/api/tools')).body.tools;
    expect(tools.map((t) => t.name)).toEqual(['github.read_pr', 'github.post_review_comment', 'github.merge_pr', 'github.approve_pr', 'kb.search', 'cloudwatch.query_logs',
      'backlog.create_story_draft', 'backlog.update_story', 'confluence.update_requirement', 'policy.change', 'deploy.staging', 'deploy.production', 'deploy.rollback']);
    expect(tools.every((t) => t.mock === true)).toBe(true);
    const me = (await eli.get('/api/me')).body;
    expect(me).toMatchObject({ sub: 'eli', groups: ['engineers'], name: 'Eli' });
    const cfg = (await request(ctx.app).get('/api/auth/config')).body.pack;
    expect(cfg).toMatchObject({ id: 'utility', agent: { sub: 'delivery-agent' } });
    expect(cfg.notice).toMatch(/INVENTED/);
    expect(cfg.notice).toMatch(/MOCK/);
    expect(JSON.stringify(cfg)).not.toMatch(/"claims"/); // the page gets names and wording, not token claims
  });

  it('the two packs keep separate policy files in one DATA_DIR, so switching PACK cannot feed one pack the other pack\'s policies', async () => {
    const dataDir = tmpDir();
    const g = mockApp({ dataDir });
    const u = mockApp({ dataDir, ...U });
    expect(fs.existsSync(path.join(dataDir, 'policies'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'policies-utility'))).toBe(true);
    expect((await call(await signedIn(g, 'mary'), 'search_flights', { query: 'x' }, {})).body.outcome).toBe('allow');
    expect((await call(await signedIn(u, 'eli'), 'github.read_pr', OPS, {})).body.outcome).toBe('allow');
    const list = (await (await signedIn(u, 'eli')).get('/api/policies')).body;
    expect(list.error).toBeNull();
    expect(list.policies.map((p) => p.id)).toEqual(['s05-rugpull-pin', 'u10-engineers-pr-review', 'u11-engineers-research', 'u12-governance-review', 'u13-analysts-backlog', 'u14-compliance-evidence',
      'u20-never-merge-or-approve-pr', 'u21-never-change-policy', 'u22-never-deploy', 'u30-hold-story-update', 'u31-hold-requirement-update', 'u40-repo-scope-engineers', 'u41-restricted-evidence-compliance-only']);
  });
});

describe('ALLOW: the five allowed tools run (mock backends) and say so', () => {
  it('each allowed tool returns a labelled mock result', async () => {
    const { eli, ben } = await world();
    const rows = [
      [eli, 'github.read_pr', OPS, 'u10-engineers-pr-review'],
      [eli, 'github.post_review_comment', { ...OPS, body: 'Add a test' }, 'u10-engineers-pr-review'],
      [eli, 'kb.search', { query: 'outage', collection: 'runbooks' }, 'u11-engineers-research'],
      [eli, 'cloudwatch.query_logs', { logGroup: 'portal-app', query: 'level=ERROR' }, 'u11-engineers-research'],
      [ben, 'backlog.create_story_draft', { title: 'Planned outage banner' }, 'u13-analysts-backlog'],
    ];
    for (const [who, tool, args, rule] of rows) {
      const r = await call(who, tool, args);
      expect(r.status, tool).toBe(200);
      expect(r.body, tool).toMatchObject({ outcome: 'allow', rule, result: { mock: true } });
    }
  });
});

describe('HOLD: updates wait for Priya, then run once or never', () => {
  it('Ben updates a story: held, Priya approves, it runs once; Ben cannot approve his own', async () => {
    const { ben, priya, eli } = await world();
    const held = await call(ben, 'backlog.update_story', { storyId: 'ST-101', change: 'Move to Ready' });
    expect(held.status).toBe(202);
    expect(held.body).toMatchObject({ outcome: 'hold', rule: 'u30-hold-story-update', approvers: ['priya'], attribution: { user: 'ben', agent: 'delivery-agent', tool: 'backlog.update_story' } });
    expect(held.body.result).toBeUndefined();
    const id = held.body.approvalId;
    expect((await priya.get('/api/approvals')).body.approvals[0]).toMatchObject({ id, status: 'pending', tool: 'backlog.update_story', requester: { sub: 'ben', actor: 'delivery-agent' } });
    expect((await ben.post(`/api/approvals/${id}/approve`)).status).toBe(403);
    expect((await eli.post(`/api/approvals/${id}/approve`)).status).toBe(404);
    const ok = await priya.post(`/api/approvals/${id}/approve`);
    expect(ok.body).toMatchObject({ status: 'approved', decidedBy: 'priya', outcome: { decision: 'allow', rule: 'u13-analysts-backlog', executed: true } });
    expect(ok.body.outcome.result).toMatchObject({ mock: true, status: 'updated' });
    expect((await priya.post(`/api/approvals/${id}/approve`)).status).toBe(409);
    expect((await call(ben, 'backlog.update_story', { storyId: 'ST-101', change: 'Move to Ready' })).body.outcome).toBe('hold'); // approval consumed
  });

  it('Priya denies: nothing runs', async () => {
    const { ben, priya } = await world();
    const id = (await call(ben, 'backlog.update_story', { storyId: 'ST-9', change: 'x' })).body.approvalId;
    const r = await priya.post(`/api/approvals/${id}/deny`);
    expect(r.body).toMatchObject({ status: 'denied', decidedBy: 'priya', outcome: { decision: 'deny', executed: false } });
    expect(r.body.outcome.result).toBeUndefined();
  });

  it('a requirement update is held for both analysts and governance reviewers, with or without the agent', async () => {
    const { ben, gwen } = await world();
    for (const [who, extra] of [[ben, { asAgent: true }], [gwen, { asAgent: true }], [gwen, {}]]) {
      const r = await call(who, 'confluence.update_requirement', { requirementId: 'REQ-17', change: 'Reword' }, extra);
      expect(r.body).toMatchObject({ outcome: 'hold', rule: 'u31-hold-requirement-update', approvers: ['priya'] });
    }
  });

  it('a person with no permit for the tool is denied, never queued for Priya', async () => {
    const { eli, priya } = await world();
    const r = await call(eli, 'backlog.update_story', { storyId: 'ST-1', change: 'x' });
    expect(r.status).toBe(403);
    expect(r.body.approvalId).toBeUndefined();
    expect((await priya.get('/api/approvals')).body.approvals).toEqual([]);
  });
});

describe('DENY always: no approval overrides it', () => {
  const denied = [
    ['github.merge_pr', OPS, 'u20-never-merge-or-approve-pr'],
    ['github.approve_pr', OPS, 'u20-never-merge-or-approve-pr'],
    ['policy.change', { policyId: 'u10', change: 'allow merge' }, 'u21-never-change-policy'],
    ['deploy.staging', { service: 'grid-ops-portal' }, 'u22-never-deploy'],
    ['deploy.production', { service: 'grid-ops-portal' }, 'u22-never-deploy'],
    ['deploy.rollback', { service: 'grid-ops-portal' }, 'u22-never-deploy'],
  ];
  it.each(denied)('%s is denied for every persona, with the agent or without, and never queued', async (tool, args, rule) => {
    const w = await world();
    for (const p of ['eli', 'gwen', 'ben', 'cora', 'priya']) {
      for (const extra of [{ asAgent: true }, {}]) {
        const r = await call(w[p], tool, args, extra);
        expect(r.status, `${p} ${tool}`).toBe(403);
        expect(r.body, `${p} ${tool}`).toMatchObject({ outcome: 'deny', rule });
        expect(r.body.approvalId).toBeUndefined();
        expect(r.body.result).toBeUndefined();
      }
    }
    expect((await w.priya.get('/api/approvals')).body.approvals).toEqual([]);
  });

  it('what-if with approvals already given (Test a request) is still a deny for the same rule', async () => {
    const { priya } = await world();
    for (const [tool, args, rule] of denied) {
      const r = await priya.post('/api/decide-test').send({ claims: { sub: 'ben', groups: ['business-analysts'], scope: 'tools:invoke', client_id: 'privilege-demo-web', act: { sub: 'delivery-agent' } }, tool, args, approvalCount: 5 });
      expect(r.body, tool).toMatchObject({ outcome: 'deny', rule });
    }
  });
});

describe('classification and repo scoping', () => {
  it('restricted evidence: only compliance reads it; everyone else is denied by classification', async () => {
    const w = await world();
    const kb = { query: 'CIP-007 patch evidence', collection: 'audit-evidence' };
    const logs = { logGroup: 'security-events', query: 'x' };
    for (const p of ['eli', 'gwen', 'ben']) {
      const r = await call(w[p], 'kb.search', kb);
      expect(r.body, p).toMatchObject({ outcome: 'deny', rule: 'u41-restricted-evidence-compliance-only' });
    }
    expect((await call(w.eli, 'cloudwatch.query_logs', logs)).body).toMatchObject({ outcome: 'deny', rule: 'u41-restricted-evidence-compliance-only' });
    expect((await call(w.cora, 'kb.search', kb)).body).toMatchObject({ outcome: 'allow', rule: 'u14-compliance-evidence', result: { mock: true, collection: 'audit-evidence' } });
    expect((await call(w.cora, 'cloudwatch.query_logs', logs)).body.outcome).toBe('allow');
    expect((await call(w.eli, 'kb.search', { ...kb, collection: 'runbooks' })).body.outcome).toBe('allow'); // same tool, internal collection
  });

  it('a caller cannot relabel the data: extra arguments are refused and an unknown collection never reaches policy', async () => {
    const { eli } = await world();
    const a = await call(eli, 'kb.search', { query: 'q', collection: 'runbooks', classification: 'public' });
    expect(a.body).toMatchObject({ outcome: 'deny', rule: 'invalid-arguments' });
    const b = await call(eli, 'kb.search', { query: 'q', collection: 'not-a-collection' });
    expect(b.body).toMatchObject({ outcome: 'deny', rule: 'invalid-arguments' });
    expect(b.body.problems.join()).toMatch(/collection must be one of/);
    expect((await call(eli, 'github.read_pr', { repo: 'not-a-repo', pr: 1 })).body.rule).toBe('invalid-arguments');
  });

  it('engineers are scoped to their repos; governance and compliance read any repo; analysts none', async () => {
    const w = await world();
    const other = { repo: 'meter-data-lake', pr: 7 };
    expect((await call(w.eli, 'github.read_pr', OPS)).body.outcome).toBe('allow');
    expect((await call(w.eli, 'github.read_pr', { repo: 'outage-notifier', pr: 3 })).body.outcome).toBe('allow');
    const x = await call(w.eli, 'github.read_pr', other);
    expect(x.body).toMatchObject({ outcome: 'deny', rule: 'u40-repo-scope-engineers', overridden: ['u10-engineers-pr-review'] });
    expect((await call(w.eli, 'github.post_review_comment', { ...other, body: 'hi' })).body.rule).toBe('u40-repo-scope-engineers');
    expect((await call(w.gwen, 'github.read_pr', other)).body.outcome).toBe('allow');
    expect((await call(w.cora, 'github.read_pr', other)).body.outcome).toBe('allow');
    expect((await call(w.ben, 'github.read_pr', OPS)).body).toMatchObject({ outcome: 'deny', rule: 'default-deny' });
  });
});

describe('trace: user AND agent AND tool on every decision', () => {
  it('policy, pep and tool hops carry sub, act.sub and the tool; events stay valid envelopes', async () => {
    const { eli } = await world();
    const r = await call(eli, 'github.read_pr', OPS);
    expect(r.body.attribution).toEqual({ user: 'eli', agent: 'delivery-agent', tool: 'github.read_pr' });
    const { events } = (await eli.get('/api/trace').query({ trace_id: r.body.trace_id })).body;
    const decided = events.filter((e) => ['policy:ai-policy', 'tool', 'pep'].includes(e.hop));
    expect(decided.map((e) => e.hop).sort()).toEqual(['pep', 'policy:ai-policy', 'tool']);
    for (const e of decided) {
      expect(e.subject, e.hop).toBe('eli');
      expect(e.actor, e.hop).toEqual({ sub: 'delivery-agent' });
      expect(e.tool, e.hop).toBe('github.read_pr');
    }
    for (const { tool: _tool, ...envelope } of events) expect(validateEvent(envelope), envelope.hop).toEqual([]); // `tool` is an app field beside the envelope
  });

  it('a denied call and a held call are attributed too, and the approval hop names the approver\'s decision against the same user, agent and tool', async () => {
    const { eli, ben, priya } = await world();
    const d = await call(eli, 'github.merge_pr', OPS);
    const dev = (await eli.get('/api/trace').query({ trace_id: d.body.trace_id })).body.events.filter((e) => e.hop === 'pep');
    expect(dev[0]).toMatchObject({ subject: 'eli', actor: { sub: 'delivery-agent' }, tool: 'github.merge_pr', decision: { result: 'deny', rule: 'u20-never-merge-or-approve-pr' } });
    const h = await call(ben, 'backlog.update_story', { storyId: 'ST-1', change: 'x' });
    await priya.post(`/api/approvals/${h.body.approvalId}/approve`);
    const ev = (await ben.get('/api/trace').query({ trace_id: h.body.trace_id })).body.events;
    const approval = ev.find((e) => e.hop === 'approval');
    expect(approval).toMatchObject({ subject: 'ben', actor: { sub: 'delivery-agent' }, tool: 'backlog.update_story', decision: { result: 'allow' } });
    expect(ev.find((e) => e.hop === 'tool')).toMatchObject({ tool: 'backlog.update_story', subject: 'ben' });
  });

  it('a person acting without the agent shows as the user with no agent', async () => {
    const { eli } = await world();
    const r = await call(eli, 'github.read_pr', OPS, {});
    expect(r.body.attribution).toEqual({ user: 'eli', agent: null, tool: 'github.read_pr' });
    const pep = (await eli.get('/api/trace').query({ trace_id: r.body.trace_id })).body.events.find((e) => e.hop === 'pep');
    expect(pep.actor).toBeNull();
    expect(pep.tool).toBe('github.read_pr');
  });
});

describe('S05 rug-pull pin still applies to this pack', () => {
  it('a drifted tool is denied for everyone until reset', async () => {
    const { eli, dana } = await world();
    expect((await dana.post('/api/admin/drift').send({ tool: 'github.read_pr', on: true })).body.drifted).toEqual(['github.read_pr']);
    expect((await call(eli, 'github.read_pr', OPS)).body).toMatchObject({ outcome: 'deny', rule: 's05-rugpull-pin' });
    expect((await call(eli, 'kb.search', { query: 'q', collection: 'runbooks' })).body.outcome).toBe('allow'); // other tools unaffected
    await dana.post('/api/reset');
    expect((await call(eli, 'github.read_pr', OPS)).body.outcome).toBe('allow');
  });
});

describe('the pack scenarios shown on screen are true through decide-test', () => {
  it('every scenario returns the outcome and rule written next to it', async () => {
    const { eli } = await world();
    for (const s of getPack('utility').web.scenarios) {
      const claims = { sub: s.sub, groups: s.groups, scope: 'tools:invoke', client_id: 'privilege-demo-web', ...(s.agent ? { act: { sub: 'delivery-agent' } } : {}) };
      const r = await eli.post('/api/decide-test').send({ claims, tool: s.tool, args: s.args, approvalCount: s.approvalCount ?? 0 });
      expect(r.body, s.id).toMatchObject({ outcome: s.expect.outcome, rule: s.expect.rule });
    }
  });
});

// ---- the /mcp door: the contract another demo calls (JSON-RPC over POST /mcp, Bearer with an optional act) ----
describe('POST /mcp contract with PACK=utility', () => {
  let pf;
  let ctx;
  beforeAll(async () => { pf = await startStubPf(); ctx = pfApp(pf, U); });
  afterAll(() => pf.close());
  const tok = (claims) => pf.mint({ client_id: 'worker-demo', scope: 'tools:invoke', ...claims });
  const callMcp = (token, name, args, id = 5) => rpc(request(ctx.app), token, 'tools/call', { name, arguments: args }, id);

  it('initialize and tools/list: the pack\'s thirteen tools, each with name, description, inputSchema and _meta.app + schemaHash', async () => {
    const t = await tok({ sub: 'eli', groups: ['engineers'] });
    const init = await rpc(request(ctx.app), t, 'initialize', { protocolVersion: '2025-11-25' });
    expect(init.body.result).toMatchObject({ protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'privilege-demo-mcp' } });
    const list = await rpc(request(ctx.app), t, 'tools/list');
    const tools = list.body.result.tools;
    expect(tools).toHaveLength(13);
    for (const x of tools) {
      expect(Object.keys(x).sort()).toEqual(['_meta', 'description', 'inputSchema', 'name']);
      expect(x._meta.app).toEqual(expect.any(String));
      expect(x._meta.schemaHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(tools.map((x) => x.name)).toContain('deploy.production');
  });

  it('tools/call allow: result.content[0].text is the JSON of the mock result; a token with act is unattended and still allowed', async () => {
    for (const claims of [{ sub: 'eli', groups: ['engineers'] }, { sub: 'eli', groups: ['engineers'], act: { sub: 'worker-demo-agent' } }]) {
      const r = await callMcp(await tok(claims), 'github.read_pr', OPS);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ jsonrpc: '2.0', id: 5, result: { content: [{ type: 'text', text: expect.any(String) }] } });
      expect(JSON.parse(r.body.result.content[0].text)).toMatchObject({ mock: true, repo: 'grid-ops-portal', pr: 42 });
    }
  });

  it('tools/call deny: error -32003 with data.decision, rule, reason, rules', async () => {
    const r = await callMcp(await tok({ sub: 'eli', groups: ['engineers'], act: { sub: 'worker-demo-agent' } }), 'github.merge_pr', OPS);
    expect(r.body.error).toMatchObject({ code: -32003, message: 'denied by policy', data: { decision: 'deny', rule: 'u20-never-merge-or-approve-pr', rules: ['u20-never-merge-or-approve-pr'] } });
    expect(r.body.error.data.reason).toMatch(/never merge or approve/);
    expect(Object.keys(r.body.error.data).sort()).toEqual(['decision', 'reason', 'rule', 'rules']);
  });

  it('tools/call hold: error -32004 with approvalId and approvers', async () => {
    const r = await callMcp(await tok({ sub: 'ben', groups: ['business-analysts'], act: { sub: 'worker-demo-agent' } }), 'backlog.update_story', { storyId: 'ST-1', change: 'x' });
    expect(r.body.error).toMatchObject({ code: -32004, message: 'held for approval', data: { decision: 'hold', rule: 'u30-hold-story-update', approvers: ['priya'] } });
    expect(r.body.error.data.approvalId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('restricted evidence over MCP: denied for engineers, allowed for compliance; no token is 401', async () => {
    const kb = { query: 'evidence', collection: 'audit-evidence' };
    expect((await callMcp(await tok({ sub: 'eli', groups: ['engineers'] }), 'kb.search', kb)).body.error.data.rule).toBe('u41-restricted-evidence-compliance-only');
    expect((await callMcp(await tok({ sub: 'cora', groups: ['compliance'] }), 'kb.search', kb)).body.result).toBeDefined();
    expect((await rpc(request(ctx.app), null, 'tools/list')).status).toBe(401);
  });

  it('a tool the pack does not list is denied before policy, and so is an argument that does not fit', async () => {
    const t = await tok({ sub: 'eli', groups: ['engineers'] });
    expect((await callMcp(t, 'deploy.canary', { service: 's' })).body.error.data.rule).toBe('unknown-tool');
    expect((await callMcp(t, 'github.read_pr', { repo: 'grid-ops-portal' })).body.error.data.rule).toBe('invalid-arguments');
  });
});

describe('the stub issuer mints the pack\'s people (local demonstration only)', () => {
  let stub;
  let url;
  let app;
  const post = (p, body) => new Promise((resolve, reject) => {
    const req = http.request(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(out) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  beforeAll(async () => {
    const probe = http.createServer();
    await new Promise((r) => probe.listen(0, '127.0.0.1', r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    url = `http://127.0.0.1:${port}`;
    stub = createStubIssuer({ issuer: url, audience: 'privilege-demo', personas: getPack('utility').personas, agent: getPack('utility').agent });
    await new Promise((r) => stub.server.listen(port, '127.0.0.1', r));
    app = makeApp({ idp: 'pf', pfUrl: url, pfIssuer: url, pfJwksUrl: `${url}/pf/JWKS`, pfAudience: 'privilege-demo', host: '0.0.0.0', ...U });
  });
  afterAll(() => new Promise((r) => { stub.server.closeAllConnections(); stub.server.close(r); }));

  it('mints Cora, whose token reads restricted evidence over /mcp; Mark is unknown to this pack', async () => {
    const m = await post('/mint', { persona: 'cora', act: 'worker-demo-agent' });
    expect(m.status).toBe(200);
    const r = await rpc(request(app.app), m.body.access_token, 'tools/call', { name: 'kb.search', arguments: { query: 'q', collection: 'audit-evidence' } });
    expect(r.body.result).toBeDefined();
    expect((await post('/mint', { persona: 'mark' })).status).toBe(400);
  });

  describe('agent-subject token (unattended lane: the agent itself is the subject, no act claim)', () => {
    const agentTok = async (extra = {}) => (await post('/mint', { agent: 'delivery-agent', ...extra })).body.access_token;
    const call = async (t, name, args) => (await rpc(request(app.app), t, 'tools/call', { name, arguments: args })).body;
    const decode = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

    it('mints sub=delivery-agent with the pack\'s agent groups, a scope, a client id, and NO act claim', async () => {
      const m = await post('/mint', { agent: 'delivery-agent' });
      expect(m.status).toBe(200);
      const c = decode(m.body.access_token);
      expect(c).toMatchObject({ sub: 'delivery-agent', groups: ['engineers', 'business-analysts'], scope: 'tools:invoke', client_id: 'privilege-demo-agent' });
      expect(c.act).toBeUndefined();
    });

    it('refuses an unknown agent, an agent combined with a persona or act, and a mismatched pack', async () => {
      expect((await post('/mint', { agent: 'someone-else' })).status).toBe(400);
      expect((await post('/mint', { agent: 'delivery-agent', persona: 'eli' })).status).toBe(400);
      expect((await post('/mint', { agent: 'delivery-agent', act: 'x' })).status).toBe(400);
      const generic = createStubIssuer({ issuer: url, audience: 'privilege-demo' });
      expect(() => generic.mint({ agent: 'dot' })).toThrow(/no agent-subject identity/);
    });

    it('is allowed the read tools, with the repo scoping still applied', async () => {
      const t = await agentTok();
      expect((await call(t, 'github.read_pr', OPS)).result).toBeDefined();
      expect((await call(t, 'kb.search', { query: 'q', collection: 'runbooks' })).result).toBeDefined();
      expect((await call(t, 'github.read_pr', { repo: 'meter-data-lake', pr: 7 })).error.data.rule).toBe('u40-repo-scope-engineers');
    });

    it('is HELD on confluence.update_requirement with the named approver, and on backlog.update_story', async () => {
      const t = await agentTok();
      const h = await call(t, 'confluence.update_requirement', { requirementId: 'REQ-1', change: 'x' });
      expect(h.error).toMatchObject({ code: -32004, data: { decision: 'hold', rule: 'u31-hold-requirement-update', approvers: ['priya'] } });
      expect((await call(t, 'backlog.update_story', { storyId: 'ST-1', change: 'x' })).error.data.rule).toBe('u30-hold-story-update');
    });

    it('is still denied the always-denied tools and restricted evidence (agent identity changes no rule)', async () => {
      const t = await agentTok();
      for (const [n, a] of [['github.merge_pr', OPS], ['github.approve_pr', OPS], ['policy.change', { policyId: 'p', change: 'x' }], ['deploy.production', { service: 's' }]]) {
        expect((await call(t, n, a)).error.code, n).toBe(-32003);
      }
      expect((await call(t, 'kb.search', { query: 'q', collection: 'audit-evidence' })).error.data.rule).toBe('u41-restricted-evidence-compliance-only');
    });

    it('records the agent as the subject in the trace/attribution (no separate actor)', async () => {
      const r = await call(await agentTok(), 'github.read_pr', OPS);
      expect(JSON.stringify(r)).not.toMatch(/"actor"/);
    });
  });
});

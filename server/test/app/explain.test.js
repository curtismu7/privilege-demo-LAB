// The explanation through the real app: tool calls, trace, approvals, Test a request, policies, and the shapes it must not touch.
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApprovals } from '../../src/approvals.js';
import { createAudit } from '../../src/audit.js';
import { createPolicyStore } from '../../src/policyStore.js';
import { createBackend } from '../../src/mcp/backend.js';
import { createExplainer } from '../../src/explain/index.js';
import { createPep } from '../../src/pep.js';
import { getPack } from '../../src/packs/index.js';
import { createSink, newTraceparent, validateEvent } from '../../src/trace/index.js';
import { createTracer } from '../../src/trace/hops.js';
import { mockApp, pfApp, signedIn, startStubPf, rpc, tmpDir } from './helpers.js';

const call = (agent, tool, args, extra = {}) => agent.post('/api/tools/call?envelope=1').send({ tool, args, ...extra });
const fare = (amount) => ({ flightId: 'FL200', amount });
const rule = (e, id) => e.rules.find((r) => r.id === id);

async function world(over = {}) {
  const ctx = mockApp(over);
  const who = {};
  for (const p of ['mark', 'mary', 'priya', 'dana']) who[p] = await signedIn(ctx, p);
  return { ctx, ...who };
}

describe('POST /api/tools/call carries the explanation', () => {
  it('allow, default deny, block, hold, pin, hold with no way through, unknown tool, invalid arguments', async () => {
    const { mark, mary, dana } = await world();
    const cases = [
      ['allow', await call(mark, 'book_fare', fare(800)), 'allowed'],
      ['default deny', await call(mark, 'pay_invoice', { invoiceId: 'INV-1', amount: 250 }), 'default-deny'],
      ['block', await call(mark, 'book_fare', fare(12000)), 'blocked'],
      ['hold', await call(mark, 'book_fare', fare(2400), { asAgent: true }), 'held'],
      ['no way through', await call(mary, 'book_fare', fare(2400), { asAgent: true }), 'hold-no-way-through'],
      ['unknown tool', await call(mark, 'nope', {}), 'before-rules'],
      ['invalid arguments', await call(mark, 'book_fare', { flightId: 'x' }), 'before-rules'],
    ];
    for (const [name, r, kind] of cases) {
      expect(r.body.explanation, name).toMatchObject({ v: 1, kind, outcome: r.body.outcome });
      expect(r.body.explanation.checks.agreed, name).toBe(true);
    }
    expect(cases[3][1].body.explanation.approval).toMatchObject({ where: '/approvals', approvers: [{ sub: 'priya', name: 'Priya' }] });
    expect(cases[2][1].body.explanation.decidedBy.id).toBe('s23-forbid-over-cap');
    expect(cases[7 - 1][1].body.explanation.before.code).toBe('invalid-arguments');
    await dana.post('/api/admin/drift').send({ tool: 'book_fare', on: true });
    const pin = await call(mark, 'book_fare', fare(500));
    expect(pin.body.explanation).toMatchObject({ kind: 'blocked', decidedBy: { id: 's05-rugpull-pin' }, asked: { schemaChanged: true } });
  });

  it('the explanation does not change the body that was already there', async () => {
    const { mark } = await world();
    const r = await call(mark, 'book_fare', fare(800));
    const { explanation, ...rest } = r.body;
    expect(explanation).toBeDefined();
    expect(Object.keys(rest).sort()).toEqual(['app', 'outcome', 'overridden', 'problems', 'reason', 'result', 'rule', 'rules', 'trace_id']);
  });

  it('a policy edit changes the next explanation, and a workspace edit stays in its workspace', async () => {
    const { ctx, mark, dana } = await world();
    const a = { 'x-workspace': 'a' };
    fs.writeFileSync(ctx.cfg.adminSwitchFile, 'on');
    const inWorkspaceA = async (persona) => { const ag = request.agent(ctx.app); await ag.post('/api/auth/mock/login').set(a).send({ persona }); return ag; };
    const danaA = await inWorkspaceA('dana');
    const markA = await inWorkspaceA('mark');
    const text = (await dana.get('/api/policies')).body.policies.find((p) => p.id === 's23-forbid-over-cap').text.replace('amount > 10000', 'amount > 100');
    expect((await danaA.put('/api/policies/s23-forbid-over-cap').set(a).send({ text })).status).toBe(200);
    const inA = await markA.post('/api/tools/call?envelope=1').set(a).send({ tool: 'book_fare', args: fare(800) });
    expect(inA.body.explanation.kind).toBe('blocked');
    expect(inA.body.explanation.why).toContain('over 100');
    const inDefault = await call(mark, 'book_fare', fare(800));
    expect(inDefault.body.explanation.kind).toBe('allowed');
  });

  it('Reset clears the explanations beside the trace', async () => {
    const { mark, dana } = await world();
    await call(mark, 'book_fare', fare(800));
    expect(Object.keys((await mark.get('/api/trace')).body.explanations).length).toBeGreaterThan(0);
    await dana.post('/api/reset');
    expect((await mark.get('/api/trace')).body).toEqual({ events: [], explanations: {} });
  });
});

describe('trace and audit are untouched', () => {
  it('every pep hop has an explanation by span id; events still pass validateEvent and gain no field; audit lines have no explanation', async () => {
    const { ctx, mark, priya } = await world();
    await call(mark, 'book_fare', fare(800));
    const held = await call(mark, 'book_fare', fare(2400), { asAgent: true });
    await priya.post(`/api/approvals/${held.body.approvalId}/approve`);
    const { events, explanations } = (await mark.get('/api/trace')).body;
    for (const e of events) expect(validateEvent(e), JSON.stringify(e)).toEqual([]);
    expect(events.some((e) => 'explanation' in e)).toBe(false);
    const hops = events.filter((e) => e.hop === 'pep' || e.hop === 'approval');
    expect(hops.length).toBeGreaterThanOrEqual(3);
    for (const e of hops) expect(explanations[e.span_id], `${e.hop} ${e.span_id}`).toMatchObject({ v: 1 });
    const audit = fs.readFileSync(path.join(ctx.dataDir, 'audit.jsonl'), 'utf8');
    expect(audit).not.toMatch(/explanation|headline/);
  });
});

describe('the trace shows an explanation only to the people the approvals list shows the call to', () => {
  it('a bystander gets none of another person\'s amounts or groups; the requester, the approver and an admin do', async () => {
    const { mark, mary, priya, dana } = await world();
    const held = await call(mark, 'book_fare', fare(4321), { asAgent: true });
    expect(held.body.outcome).toBe('hold');
    expect((await mary.get('/api/approvals')).body.approvals).toHaveLength(0);
    const seen = async (agent) => (await agent.get('/api/trace')).body;
    const bystander = await seen(mary);
    expect(bystander.events.length).toBeGreaterThan(0); // the events themselves are as before
    expect(bystander.explanations).toEqual({});
    expect(JSON.stringify(bystander)).not.toContain('4321');
    for (const who of [mark, priya, dana]) expect(JSON.stringify((await seen(who)).explanations)).toContain('4321');
    await priya.post(`/api/approvals/${held.body.approvalId}/approve`);
    expect(Object.keys((await seen(priya)).explanations).length).toBeGreaterThanOrEqual(2); // the approval hop too
    expect((await seen(mary)).explanations).toEqual({});
  });
});

describe('approvals carry the explanation', () => {
  it('pending: why it was held; approved: the recheck and the run; denied and expired: the answer', async () => {
    const { ctx, mark, priya } = await world();
    const held = await call(mark, 'book_fare', fare(2400), { asAgent: true });
    const view = (await priya.get(`/api/approvals/${held.body.approvalId}`)).body;
    expect(view.explanation).toMatchObject({ kind: 'held', approval: { approvers: [{ sub: 'priya' }] } });
    const ok = (await priya.post(`/api/approvals/${held.body.approvalId}/approve`)).body;
    expect(ok.outcome.explanation).toMatchObject({ kind: 'allowed', outcome: 'allow', headline: 'Priya approved. book_fare ran once.' });
    expect(ok.outcome.explanation.why).toContain('Priya approved. The rules were checked again with one approval recorded and now allow it');

    const second = await call(mark, 'book_fare', fare(2500), { asAgent: true });
    const no = (await priya.post(`/api/approvals/${second.body.approvalId}/deny`)).body;
    expect(no.outcome.explanation).toMatchObject({ kind: 'approval-denied', headline: 'Priya denied this request, so book_fare did not run.' });

    const third = await call(mark, 'book_fare', fare(2600), { asAgent: true });
    ctx.clock.t += 11 * 60 * 1000;
    const gone = (await mark.get(`/api/approvals/${third.body.approvalId}`)).body;
    expect(gone.outcome.explanation).toMatchObject({ kind: 'approval-expired' });
    const { explanations } = (await mark.get('/api/trace')).body;
    expect(Object.values(explanations).map((e) => e.kind)).toEqual(expect.arrayContaining(['approval-denied', 'approval-expired']));
  });
  it('approved after a rug pull: the recheck still denies and the explanation says so', async () => {
    const { mark, priya, dana } = await world();
    const id = (await call(mark, 'book_fare', fare(2400), { asAgent: true })).body.approvalId;
    await dana.post('/api/admin/drift').send({ tool: 'book_fare', on: true });
    const r = (await priya.post(`/api/approvals/${id}/approve`)).body;
    expect(r.outcome.explanation.headline).toBe('Priya approved, but the rules still deny it.');
    expect(r.outcome.explanation.decidedBy.id).toBe('s05-rugpull-pin');
  });
});

describe('the MCP door and other pinned shapes', () => {
  it('/mcp error data keeps exactly decision, reason, rule, rules (a hold adds approvalId, approvers) and carries no explanation', async () => {
    const pf = await startStubPf();
    try {
      const ctx = pfApp(pf);
      const t = await pf.mint({ sub: 'mark', groups: ['travel-agents'], act: { sub: 'dot' } });
      const deny = await rpc(request(ctx.app), await pf.mint({ sub: 'mary', groups: ['analysts'] }), 'tools/call', { name: 'pay_invoice', arguments: { invoiceId: 'i', amount: 1 } });
      expect(Object.keys(deny.body.error.data).sort()).toEqual(['decision', 'reason', 'rule', 'rules']);
      const hold = await rpc(request(ctx.app), t, 'tools/call', { name: 'book_fare', arguments: fare(2400) });
      expect(Object.keys(hold.body.error.data).sort()).toEqual(['approvalId', 'approvers', 'decision', 'reason', 'rule', 'rules']);
      expect(JSON.stringify(deny.body) + JSON.stringify(hold.body)).not.toContain('explanation');
    } finally { await pf.close(); }
  });

  it('live mode never turns a real user called mark into the demo\'s Mark', async () => {
    const pf = await startStubPf();
    try {
      const ctx = pfApp(pf);
      const t = await pf.mint({ sub: 'mark', groups: ['travel-agents'] });
      const r = await request(ctx.app).post('/api/tools/call?envelope=1').set('authorization', `Bearer ${t}`).send({ tool: 'book_fare', args: fare(800) });
      expect(r.body.explanation.who).toMatchObject({ sub: 'mark', name: 'mark', via: 'a PingFederate access token' });
    } finally { await pf.close(); }
  });

  it('POST /api/decide-test: no explanation unless explain:true; the explanation says what the console would answer', async () => {
    const { mark } = await world();
    const body = { claims: { sub: 'mary', groups: ['analysts'], scope: 'tools:invoke', client_id: 'c', act: { sub: 'dot' } }, tool: 'book_fare', args: fare(2400) };
    const plain = (await mark.post('/api/decide-test').send(body)).body;
    expect(plain.explanation).toBeUndefined();
    expect(plain.outcome).toBe('hold'); // decide-test's own answer is unchanged
    const asked = (await mark.post('/api/decide-test').send({ ...body, explain: true })).body;
    expect(asked.outcome).toBe('hold');
    expect(asked.explanation).toMatchObject({ outcome: 'deny', kind: 'hold-no-way-through', who: { via: 'details typed into Test a request' } });
    const console_ = await signedIn(mockApp(), 'mary');
    expect((await call(console_, 'book_fare', fare(2400), { asAgent: true })).body.outcome).toBe('deny');
  });

  it('Test a request with claims the server rejects explains that nothing was checked', async () => {
    const { mark } = await world();
    const r = (await mark.post('/api/decide-test').send({ claims: { sub: 'x', groups: 'nope' }, tool: 'book_fare', args: fare(1), explain: true })).body;
    expect(r.explanation).toMatchObject({ kind: 'before-rules', before: { code: 'invalid-claims' } });
  });

  it('GET /api/policies rows carry a meaning that follows the saved text; POST /api/policies/explain previews unsaved text; validate is unchanged', async () => {
    const { mary, dana } = await world();
    const rows = (await mary.get('/api/policies')).body.policies;
    expect(rows.find((p) => p.id === 's23-forbid-over-cap').meaning).toMatchObject({ kind: 'block', kindLabel: 'Block rule', explainedFrom: 'structure',
      does: 'Blocks calls (attended or unattended) to the book_fare tool when an amount is given and the amount is over 10000.' });
    const text = rows.find((p) => p.id === 's23-forbid-over-cap').text.replace('amount > 10000', 'amount > 7');
    expect((await mary.post('/api/policies/explain').send({ id: 's23-forbid-over-cap', text })).status).toBe(403);
    const preview = (await dana.post('/api/policies/explain').send({ id: 's23-forbid-over-cap', text })).body;
    expect(preview.meaning.does).toContain('over 7');
    expect((await dana.post('/api/policies/explain').send({ id: 'bad', text: 'permit (' })).body).toMatchObject({ ok: false, problems: [{ policyId: 'bad' }] });
    expect((await dana.post('/api/policies/explain').send({})).status).toBe(400);
    expect((await dana.get('/api/policies')).body.policies.find((p) => p.id === 's23-forbid-over-cap').meaning.does).toContain('over 10000'); // not saved
    expect((await dana.post('/api/policies/validate').send({ id: 'ok', text: 'permit (principal, action, resource);' })).body).toEqual({ ok: true, problems: [] });
    await dana.put('/api/policies/s23-forbid-over-cap').send({ text });
    expect((await mary.get('/api/policies')).body.policies.find((p) => p.id === 's23-forbid-over-cap').meaning.does).toContain('over 7');
  });

  it('the netguard sees zero attempts after a batch of explained calls in mock mode', async () => {
    const { ctx, mark } = await world();
    for (const amount of [1, 800, 12000]) await call(mark, 'book_fare', fare(amount));
    await call(mark, 'book_fare', fare(2400), { asAgent: true });
    expect(ctx.app.locals.netguard.stats()).toEqual({ realAttempts: 0, refused: 0 });
  });
});

describe('an explanation can never change a decision', () => {
  const now = () => 1_800_000_000_000;
  function pepWith(explainer) {
    const dir = tmpDir();
    const pack = getPack('generic');
    const tracer = createTracer({ sink: createSink({ size: 100 }), now });
    const approvals = createApprovals({ now, ttlMs: 600000 });
    return createPep({ backend: createBackend({ tools: pack.tools }), store: createPolicyStore({ dataDir: dir, pack }), approvals, tracer, audit: createAudit({ dataDir: dir, now }), now, explainer });
  }
  const decisionOf = (o) => ({ outcome: o.outcome, rule: o.rule, reason: o.reason, rules: [...o.rules].sort(), overridden: [...o.overridden].sort(), problems: o.problems, app: o.app, approvers: o.approvers, hasApproval: Boolean(o.approvalId), result: o.result });
  const pack = getPack('generic');
  const explainer = createExplainer({ pack, customer: { config: { cast: {} } }, mode: () => 'mock' });
  const boom = { forCall() { throw new Error('boom'); }, forBefore() { throw new Error('boom'); }, forAnswer() { throw new Error('boom'); } };
  const claimsOf = (sub, groups, act) => ({ sub, groups, scope: 'tools:invoke', client_id: 'c', ...(act ? { act: { sub: 'dot' } } : {}) });

  it('with no explainer, a real explainer, and one that throws: the same decision for every request, and the throwing one never leaks', () => {
    const peps = { none: pepWith(null), real: pepWith(explainer), boom: pepWith(boom) };
    const requests = [];
    for (const [sub, groups] of [['mark', ['travel-agents']], ['mary', ['analysts']], ['u', []], ['f', ['finance']]]) {
      for (const act of [false, true]) {
        requests.push([sub, groups, act, 'search_flights', { query: 'q' }], [sub, groups, act, 'pay_invoice', { invoiceId: 'i', amount: 5 }]);
        for (const amount of [800, 2400, 12000]) requests.push([sub, groups, act, 'book_fare', fare(amount)]);
      }
    }
    requests.push(['mark', ['travel-agents'], false, 'nope', {}], ['mark', ['travel-agents'], false, 'book_fare', { flightId: 'x' }]);
    for (const [sub, groups, act, tool, args] of requests) {
      const out = Object.fromEntries(Object.entries(peps).map(([k, pep]) => [k, pep.enforce({ claims: claimsOf(sub, groups, act), tool, args, source: 'session', traceparent: newTraceparent() })]));
      expect(decisionOf(out.real), JSON.stringify([sub, act, tool, args])).toEqual(decisionOf(out.none));
      expect(decisionOf(out.boom)).toEqual(decisionOf(out.none));
      expect(out.none.explanation).toBeUndefined();
      expect(out.boom.explanation).toBeUndefined();
      expect(out.real.explanation).toMatchObject({ v: 1 });
    }
  });

  it('the explainer\'s own guard turns an exception into the error object', () => {
    const e = explainer.forCall(null);
    expect(e).toMatchObject({ v: 1, error: true });
    expect(e.text).toBe('An explanation could not be built. The decision above is not affected.');
  });
});

describe('utility pack through the app', () => {
  it('names the delivery agent, the repository and the approver, and holds explain where to approve', async () => {
    const ctx = mockApp({ pack: 'utility' });
    const ben = await signedIn(ctx, 'ben');
    const eli = await signedIn(ctx, 'eli');
    const held = await call(ben, 'backlog.update_story', { storyId: 'ST-101', change: 'x' }, { asAgent: true });
    expect(held.body.explanation).toMatchObject({ kind: 'held', who: { name: 'Ben', agent: { name: 'Delivery Agent' } }, approval: { approvers: [{ name: 'Priya' }] } });
    const repo = await call(eli, 'github.read_pr', { repo: 'meter-data-lake', pr: 7 }, { asAgent: true });
    expect(repo.body.explanation.asked.details).toContainEqual({ label: 'repository', value: 'meter-data-lake' });
    expect(rule(repo.body.explanation, 'u40-repo-scope-engineers').status).toBe('blocked');
    expect(repo.body.attribution).toMatchObject({ user: 'eli', agent: 'delivery-agent' });
  });
});

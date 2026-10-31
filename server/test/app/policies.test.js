import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mockApp, makeApp, signedIn } from './helpers.js';
import { validId } from '../../src/policyStore.js';

async function world() {
  const ctx = mockApp();
  return { ctx, mary: await signedIn(ctx, 'mary'), mark: await signedIn(ctx, 'mark'), dana: await signedIn(ctx, 'dana') };
}
const test = (agent, body) => agent.post('/api/decide-test').send(body);
const maryClaims = { sub: 'mary', groups: ['analysts'], scope: 'tools:invoke', client_id: 'c' };
const OWN = `@id("t-analysts-book")\n@reason("Test: analysts may book")\npermit (principal in Group::"analysts", action == Action::"mcp:Invoke", resource)\nwhen { context.app == "booking" };`;

describe('policy store and endpoints', () => {
  it('lists the six shipped policies as Active, readable by any signed-in user', async () => {
    const { mary } = await world();
    const r = await mary.get('/api/policies');
    expect(r.body.policies).toHaveLength(6);
    expect(r.body.policies.every((p) => p.state === 'active')).toBe(true);
    expect(r.body.policies.find((p) => p.id === 's01-hold-large-fare')).toMatchObject({ effect: 'forbid', approvers: 'priya', reason: expect.any(String) });
  });
  it('writes are admin only; anonymous is 401', async () => {
    const { ctx, mary } = await world();
    expect((await mary.put('/api/policies/t-analysts-book').send({ text: OWN })).status).toBe(403);
    expect((await mary.delete('/api/policies/s05-rugpull-pin')).status).toBe(403);
    expect((await mary.post('/api/policies/validate').send({ policies: {} })).status).toBe(403);
    expect((await mary.post('/api/reset')).status).toBe(403);
    expect((await request(ctx.app).put('/api/policies/x').send({ text: OWN })).status).toBe(401);
  });
  it('POST /validate: ok, syntax error, schema error, id mismatch, limits', async () => {
    const { dana } = await world();
    expect((await dana.post('/api/policies/validate').send({ id: 't-analysts-book', text: OWN })).body).toEqual({ ok: true, problems: [] });
    const syntax = (await dana.post('/api/policies/validate').send({ policies: { bad: 'permit (' } })).body;
    expect(syntax.ok).toBe(false);
    expect(syntax.problems[0].policyId).toBe('bad');
    const schema = (await dana.post('/api/policies/validate').send({ policies: { s: 'permit (principal, action, resource) when { context.nope == 1 };' } })).body;
    expect(schema.ok).toBe(false);
    expect((await dana.post('/api/policies/validate').send({ policies: { a: '@id("b")\npermit (principal, action, resource);' } })).body.ok).toBe(false);
    const big = (await dana.post('/api/policies/validate').send({ policies: { big: `// ${'x'.repeat(5000)}\npermit (principal, action, resource);` } })).body;
    expect(big.problems[0].message).toMatch(/too large/);
    expect((await dana.post('/api/policies/validate').send({})).body.ok).toBe(false);
  });
  it('an invalid PUT is 422 and installs nothing', async () => {
    const { dana } = await world();
    const r = await dana.put('/api/policies/broken').send({ text: 'permit (principal, action, resource) when { context.nope };' });
    expect(r.status).toBe(422);
    expect(r.body.problems.length).toBeGreaterThan(0);
    expect((await dana.get('/api/policies')).body.policies.map((p) => p.id)).not.toContain('broken');
    expect((await dana.put('/api/policies/..%2Fevil').send({ text: OWN })).status).toBe(422);
    expect((await dana.put('/api/policies/x').send({ text: OWN, state: 'live' })).status).toBe(422);
    expect((await dana.put('/api/policies/x').send({})).status).toBe(400);
  });
  it('policy ids that could escape the policies directory are refused and nothing is written outside it', async () => {
    const { dana, ctx } = await world();
    for (const bad of ['../x', '..%2Fx', '%2e%2e%2fx', 'a%2Fb', 'a%00b', 'x'.repeat(101), 'a b']) {
      const r = await dana.put(`/api/policies/${bad}`).send({ text: OWN });
      expect(r.status, bad).toBeGreaterThanOrEqual(400);
      expect(r.status, bad).toBeLessThan(500);
    }
    expect(fs.existsSync(path.join(ctx.dataDir, 'x.cedar'))).toBe(false);
    expect(fs.existsSync(path.join(ctx.dataDir, 'policies', 'x.cedar'))).toBe(false);
    for (const ok of ['a', 'a.b:c_d-1'.replace('_', '-')]) expect(validId(ok)).toBe(true);
    for (const bad of ['../x', 'a/b', 'a\\b', 'a\0b', '', 'x'.repeat(101), 'a b', 5, null]) expect(validId(bad)).toBe(false);
  });
  it('an active PUT changes live decisions; DELETE reverts', async () => {
    const { dana, mary } = await world();
    const book = () => mary.post('/api/tools/call').send({ tool: 'book_fare', args: { flightId: 'F', amount: 10 } });
    expect((await book()).body.outcome).toBe('deny');
    expect((await dana.put('/api/policies/t-analysts-book').send({ text: OWN })).status).toBe(200);
    expect((await book()).body).toMatchObject({ outcome: 'allow', rule: 't-analysts-book' });
    expect((await dana.delete('/api/policies/t-analysts-book')).status).toBe(200);
    expect((await book()).body.outcome).toBe('deny');
    expect((await dana.delete('/api/policies/t-analysts-book')).status).toBe(404);
  });
  it('deleting every Active policy leaves default deny', async () => {
    const { dana, mary } = await world();
    for (const p of (await dana.get('/api/policies')).body.policies) await dana.delete(`/api/policies/${p.id}`);
    const r = await mary.post('/api/tools/call').send({ tool: 'search_flights', args: { query: 'x' } });
    expect(r.body).toMatchObject({ outcome: 'deny', rule: 'default-deny' });
  });
  it('reset restores the six shipped policies, drops candidates and drift', async () => {
    const { dana, mary } = await world();
    await dana.put('/api/policies/t-analysts-book').send({ text: OWN, state: 'candidate' });
    await dana.delete('/api/policies/s04-analysts-search-ticketing');
    await dana.post('/api/admin/drift').send({ tool: 'search_flights', on: true });
    expect((await dana.post('/api/reset')).status).toBe(200);
    const list = (await dana.get('/api/policies')).body.policies;
    expect(list).toHaveLength(6);
    expect(list.some((p) => p.state === 'candidate')).toBe(false);
    expect((await mary.post('/api/tools/call').send({ tool: 'search_flights', args: { query: 'x' } })).body.outcome).toBe('allow');
  });
  it('edits are files under DATA_DIR and survive a restart', async () => {
    const { ctx, dana } = await world();
    await dana.put('/api/policies/t-analysts-book').send({ text: OWN });
    await dana.put('/api/policies/t-cand').send({ text: OWN.replace('t-analysts-book', 't-cand'), state: 'candidate' });
    expect(fs.existsSync(path.join(ctx.dataDir, 'policies/active/t-analysts-book.cedar'))).toBe(true);
    expect(fs.existsSync(path.join(ctx.dataDir, 'policies/candidate/t-cand.cedar'))).toBe(true);
    const again = makeApp({ mockSignin: true, host: '127.0.0.1', dataDir: ctx.dataDir });
    const mary = await signedIn(again, 'mary');
    const ids = (await mary.get('/api/policies')).body.policies.map((p) => `${p.state}:${p.id}`);
    expect(ids).toContain('active:t-analysts-book');
    expect(ids).toContain('candidate:t-cand');
  });
  it('a policy set that is broken on disk fails closed: everything is denied and the error is shown', async () => {
    const { ctx } = await world();
    fs.writeFileSync(path.join(ctx.dataDir, 'policies/active/zz-broken.cedar'), 'permit (');
    const again = makeApp({ mockSignin: true, host: '127.0.0.1', dataDir: ctx.dataDir });
    const mary = await signedIn(again, 'mary');
    expect((await mary.post('/api/tools/call').send({ tool: 'search_flights', args: { query: 'x' } })).body.outcome).toBe('deny');
    expect((await mary.get('/api/policies')).body.error[0].policyId).toBe('zz-broken');
  });
});

describe('POST /api/decide-test and Candidate shadow evaluation', () => {
  it('returns the full decision: rules, overridden, reason', async () => {
    const { mark } = await world();
    const r = await test(mark, { claims: { sub: 't', groups: ['travel-agents'], scope: 's', client_id: 'c' }, tool: 'book_fare', args: { flightId: 'F', amount: 10001 } });
    expect(r.body).toMatchObject({ outcome: 'deny', decision: 'deny', rule: 's23-forbid-over-cap', rules: ['s23-forbid-over-cap'], overridden: ['s23-permit-travel-agents'], shadow: null });
  });
  it('classifies a hold with its approvers; approvalCount 1 clears it', async () => {
    const { mark } = await world();
    const claims = { sub: 't', groups: ['travel-agents'], scope: 's', client_id: 'c', act: { sub: 'dot' } };
    const held = await test(mark, { claims, tool: 'book_fare', args: { flightId: 'F', amount: 2000 } });
    expect(held.body).toMatchObject({ outcome: 'hold', approvers: ['priya'] });
    expect((await test(mark, { claims, tool: 'book_fare', args: { flightId: 'F', amount: 2000 }, approvalCount: 1 })).body.outcome).toBe('allow');
  });
  it('drift:true simulates the rug pull without touching the backend', async () => {
    const { mary } = await world();
    const r = await test(mary, { claims: maryClaims, tool: 'search_flights', args: { query: 'x' }, drift: true });
    expect(r.body.rule).toBe('s05-rugpull-pin');
    expect((await test(mary, { claims: maryClaims, tool: 'search_flights', args: { query: 'x' } })).body.outcome).toBe('allow');
  });
  it('bad claims fail closed; unknown tool and bad approvalCount are 400', async () => {
    const { mary } = await world();
    expect((await test(mary, { claims: { sub: 'x' }, tool: 'search_flights', args: { query: 'x' } })).body).toMatchObject({ outcome: 'deny', rule: 'invalid-claims' });
    expect((await test(mary, { claims: maryClaims, tool: 'nope' })).status).toBe(400);
    expect((await test(mary, { claims: maryClaims, tool: 'search_flights', args: { query: 'x' }, approvalCount: -1 })).status).toBe(400);
  });
  it('a Candidate shows what it would change for this request, without affecting live traffic', async () => {
    const { dana, mary } = await world();
    await dana.put('/api/policies/t-analysts-book').send({ text: OWN, state: 'candidate' });
    const book = { claims: maryClaims, tool: 'book_fare', args: { flightId: 'F', amount: 10 } };
    const changed = (await test(mary, book)).body;
    expect(changed.outcome).toBe('deny');
    expect(changed.shadow).toMatchObject({ changed: true, candidates: ['t-analysts-book'], active: { outcome: 'deny', rule: 'default-deny' }, candidate: { outcome: 'allow', rule: 't-analysts-book' } });
    const same = (await test(mary, { claims: maryClaims, tool: 'search_flights', args: { query: 'x' } })).body;
    expect(same.shadow.changed).toBe(false);
    // live traffic still uses Active only
    expect((await mary.post('/api/tools/call').send({ tool: 'book_fare', args: { flightId: 'F', amount: 10 } })).body.outcome).toBe('deny');
    // promoting (an Active PUT) makes it live and clears the candidate
    await dana.put('/api/policies/t-analysts-book').send({ text: OWN });
    expect((await test(mary, book)).body).toMatchObject({ outcome: 'allow', shadow: null });
  });
  it('a Candidate that replaces an Active id is compared against it', async () => {
    const { dana, mary } = await world();
    const weaker = (await mary.get('/api/policies')).body.policies.find((p) => p.id === 's23-forbid-over-cap').text.replace('amount > 10000', 'amount > 99999');
    await dana.put('/api/policies/s23-forbid-over-cap').send({ text: weaker, state: 'candidate' });
    const r = await test(mary, { claims: { sub: 't', groups: ['travel-agents'], scope: 's', client_id: 'c' }, tool: 'book_fare', args: { flightId: 'F', amount: 20000 } });
    expect(r.body.shadow).toMatchObject({ changed: true, active: { rule: 's23-forbid-over-cap' }, candidate: { outcome: 'allow' } });
  });
  it('requires sign-in', async () => {
    const { ctx } = await world();
    expect((await request(ctx.app).post('/api/decide-test').send({})).status).toBe(401);
  });
});

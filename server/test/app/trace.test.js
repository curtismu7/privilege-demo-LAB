import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { validateEvent } from '../../src/trace/index.js';
import { startupProblems } from '../../src/config.js';
import { createAudit } from '../../src/audit.js';
import { mockApp, signedIn, pfApp, startStubPf, rpc, bearer, tmpDir } from './helpers.js';

const fare = (amount) => ({ flightId: 'FL200', amount });
const TP = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

describe('trace envelope and audit', () => {
  it('emits auth, cedar, tool and pep hops for an allow, one chain, with traceparent propagation', async () => {
    const ctx = mockApp();
    const mary = await signedIn(ctx, 'mary');
    const r = await mary.post('/api/tools/call').set('traceparent', TP).send({ tool: 'search_flights', args: { query: 'x' } });
    expect(r.headers.traceparent).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/);
    expect(r.body.trace_id).toBe('0af7651916cd43dd8448eb211c80319c');
    const { events } = (await mary.get('/api/trace').query({ trace_id: r.body.trace_id })).body;
    expect(events.map((e) => e.hop).reverse()).toEqual(['auth', 'policy:ai-policy', 'tool', 'pep']); // newest first
    const oldest = events[events.length - 1];
    expect(oldest.parent_span_id).toBe('b7ad6b7169203331');
    const bySpan = new Map(events.map((e) => [e.span_id, e]));
    for (const e of events.slice(0, -1)) expect(bySpan.has(e.parent_span_id)).toBe(true); // a chain
    for (const e of events) { expect(validateEvent(e)).toEqual([]); expect(e.subject).toBe('mary'); }
    expect(events.find((e) => e.hop === 'policy:ai-policy')).toMatchObject({ product: 'cedar', decision: { result: 'allow', rule: 's04-analysts-search-ticketing' } });
  });
  it('every audit line carries the same trace_id as the trace events of its request; a hex secret in free text is still withheld', async () => {
    const ctx = mockApp();
    const mary = await signedIn(ctx, 'mary');
    const r = await mary.post('/api/tools/call').send({ tool: 'search_flights', args: { query: 'x' } });
    const mark = await signedIn(ctx, 'mark');
    const h = await mark.post('/api/tools/call').send({ tool: 'book_fare', args: { flightId: 'F', amount: 2400 }, asAgent: true });
    const lines = fs.readFileSync(`${ctx.dataDir}/audit.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(l.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(lines.map((l) => l.trace_id)).toEqual([r.body.trace_id, h.body.trace_id]);
    for (const id of [r.body.trace_id, h.body.trace_id]) {
      const ev = (await mary.get('/api/trace').query({ trace_id: id })).body.events;
      expect(ev.length).toBeGreaterThan(0);
      expect(ev.every((e) => e.trace_id === id)).toBe(true);
    }
    const dir = tmpDir();
    const a = createAudit({ dataDir: dir });
    const secret = 'a1b2c3d4'.repeat(4);
    a.write({ kind: 'x', tool: secret, trace_id: secret });
    expect(a.read()[0]).toMatchObject({ tool: '[withheld]', trace_id: secret });
  });
  it('GET /api/trace is newest first and needs sign-in', async () => {
    const ctx = mockApp();
    const mary = await signedIn(ctx, 'mary');
    await mary.post('/api/tools/call').send({ tool: 'search_flights', args: { query: 'x' } });
    await mary.post('/api/tools/call').send({ tool: 'pay_invoice', args: { invoiceId: 'i', amount: 1 } });
    const ev = (await mary.get('/api/trace')).body.events;
    expect(ev[0].hop).toBe('pep');
    expect(ev[0].decision.result).toBe('deny');
    const ts = ev.map((e) => e.ts);
    expect([...ts].sort().reverse()).toEqual(ts);
    expect((await request(ctx.app).get('/api/trace')).status).toBe(401);
  });
  it('a hold and its approval share one trace, including an approval hop and an actor', async () => {
    const ctx = mockApp();
    const [mark, priya] = [await signedIn(ctx, 'mark'), await signedIn(ctx, 'priya')];
    const held = await mark.post('/api/tools/call').send({ tool: 'book_fare', args: fare(2400), asAgent: true });
    expect(held.body.outcome).toBe('hold');
    const id = held.body.approvalId;
    await priya.post(`/api/approvals/${id}/approve`);
    const ev = (await priya.get('/api/trace').query({ trace_id: held.body.trace_id })).body.events;
    const hops = ev.map((e) => e.hop).reverse();
    expect(hops.slice(0, 3)).toEqual(['auth', 'policy:ai-policy', 'pep']);
    expect(hops).toEqual(expect.arrayContaining(['auth', 'pep', 'policy:ai-policy', 'tool', 'approval']));
    expect(ev.find((e) => e.hop === 'approval')).toMatchObject({ subject: 'mark', actor: { sub: 'dot' }, decision: { result: 'allow' } });
    expect(ev.find((e) => e.hop === 'pep').decision.result).toBe('hold');
    for (const e of ev) expect(validateEvent(e)).toEqual([]);
  });
  it('expiry emits an approval hop (deny) on the same trace', async () => {
    const ctx = mockApp();
    const [mark, priya] = [await signedIn(ctx, 'mark'), await signedIn(ctx, 'priya')];
    const held = await mark.post('/api/tools/call').send({ tool: 'book_fare', args: fare(2400), asAgent: true });
    ctx.clock.t += 11 * 60 * 1000;
    await priya.get('/api/approvals');
    const ev = (await priya.get('/api/trace').query({ trace_id: held.body.trace_id })).body.events;
    expect(ev[0]).toMatchObject({ hop: 'approval', decision: { result: 'deny', rule: 'approval-expired' } });
  });
  it('writes one audit line per decision: tool calls, approvals, policy edits, reset', async () => {
    const ctx = mockApp();
    const [mark, priya, dana] = [await signedIn(ctx, 'mark'), await signedIn(ctx, 'priya'), await signedIn(ctx, 'dana')];
    await mark.post('/api/tools/call').send({ tool: 'book_fare', args: fare(10), });
    const held = await mark.post('/api/tools/call').send({ tool: 'book_fare', args: fare(2400), asAgent: true });
    await priya.post(`/api/approvals/${held.body.approvalId}/approve`);
    await dana.delete('/api/policies/s05-rugpull-pin');
    await dana.post('/api/reset');
    const lines = fs.readFileSync(`${ctx.dataDir}/audit.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => `${l.kind}:${l.outcome ?? l.ok ?? ''}`)).toEqual(['tool_call:allow', 'tool_call:hold', 'approval:allow', 'policy_delete:true', 'reset:']);
    expect(lines[0]).toMatchObject({ sub: 'mark', tool: 'book_fare', rule: 's23-permit-travel-agents', source: 'session' });
    expect(lines[2]).toMatchObject({ approver: 'priya', approved: true, executed: true });
    for (const l of lines) expect(l.ts).toMatch(/Z$/);
  });
});

describe('no raw tokens anywhere (sentinels)', () => {
  let pf;
  beforeAll(async () => { pf = await startStubPf(); });
  afterAll(() => pf.close());

  it('valid, expired, forged and malformed Bearer tokens and a session cookie never reach a log, trace, audit or response', async () => {
    const logs = [];
    const spies = ['log', 'error', 'warn', 'info', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation((...a) => logs.push(a.map(String).join(' '))));
    const out = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { logs.push(String(c)); return true; });
    const ctx = pfApp(pf);
    const sentinels = [
      await pf.mint({ sub: 'priya' }),
      await pf.mint({ sub: 'mark', act: { sub: 'dot' } }),
      await pf.mint({}, { exp: Math.floor(Date.now() / 1000) - 3600 }),
      await pf.mint({}, { key: pf.wrongKey }),
      await pf.mint({}, { aud: 'x' }),
      'eyJhbGciOiJub25lIn0.eyJzdWIiOiJhIn0.SENTINELSIGNATURE0123456789',
      'SENTINEL-opaque-token-0123456789abcdef',
    ];
    const seen = [];
    const keep = (r) => seen.push(JSON.stringify([r.status, r.headers, r.body, r.text]));
    for (const t of sentinels) {
      keep(await request(ctx.app).get('/api/me').set(bearer(t)));
      keep(await request(ctx.app).post('/api/tools/call').set(bearer(t)).send({ tool: 'book_fare', args: fare(2400) }));
      keep(await rpc(request(ctx.app), t, 'tools/call', { name: 'book_fare', arguments: fare(2400) }));
      keep(await request(ctx.app).get('/api/approvals').set(bearer(t)));
      keep(await request(ctx.app).get('/api/trace').set(bearer(t)));
    }
    // a held call from a valid token, then the approver's token
    const hold = await rpc(request(ctx.app), sentinels[1], 'tools/call', { name: 'book_fare', arguments: fare(2400) });
    keep(await request(ctx.app).post(`/api/approvals/${hold.body.error.data.approvalId}/approve`).set(bearer(sentinels[0])));
    const trace = JSON.stringify((await request(ctx.app).get('/api/trace').set(bearer(sentinels[0]))).body);
    const audit = fs.existsSync(`${ctx.dataDir}/audit.jsonl`) ? fs.readFileSync(`${ctx.dataDir}/audit.jsonl`, 'utf8') : '';
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.parse(trace).events.length).toBeGreaterThan(5);

    const pieces = sentinels.flatMap((t) => [t, ...t.split('.').filter((p) => p.length > 8)]);
    const haystacks = { responses: seen.join('\n'), trace, audit, logs: logs.join('\n') };
    spies.forEach((s) => s.mockRestore());
    out.mockRestore();
    for (const [where, text] of Object.entries(haystacks)) for (const p of pieces) expect(text.includes(p), `${where} contains a token fragment`).toBe(false);
  });
  it('the mock session cookie value is not echoed into trace or audit', async () => {
    const ctx = mockApp();
    const login = await request(ctx.app).post('/api/auth/mock/login').send({ persona: 'mary' });
    const cookie = login.headers['set-cookie'][0].split(';')[0].split('=')[1];
    const agent = request.agent(ctx.app);
    await agent.post('/api/auth/mock/login').send({ persona: 'mary' });
    await agent.post('/api/tools/call').send({ tool: 'search_flights', args: { query: 'x' } });
    const trace = JSON.stringify((await agent.get('/api/trace')).body);
    const audit = fs.readFileSync(`${ctx.dataDir}/audit.jsonl`, 'utf8');
    for (const piece of cookie.split('.')) { expect(trace).not.toContain(piece); expect(audit).not.toContain(piece); }
  });
  it('a hostile sub that looks like a credential is withheld from the trace, not stored', async () => {
    const ctx = pfApp(pf);
    const evil = `Bearer ${'a1'.repeat(20)}`;
    await rpc(request(ctx.app), await pf.mint({ sub: evil }), 'tools/call', { name: 'search_flights', arguments: { query: 'x' } });
    const events = (await request(ctx.app).get('/api/trace').set(bearer(await pf.mint()))).body.events;
    expect(JSON.stringify(events)).not.toContain('a1a1a1a1');
    expect(fs.readFileSync(`${ctx.dataDir}/audit.jsonl`, 'utf8')).not.toContain('a1a1a1a1');
  });
});

describe('startup refusals', () => {
  const base = { nodeEnv: '', idp: 'local-mock', mockSignin: true, host: '127.0.0.1', pfUrl: '', pfAudience: '', pfIssuer: '', pfJwksUrl: '' };
  it('NODE_ENV=production is not a startup problem by itself', () => expect(startupProblems({ ...base, nodeEnv: 'production' })).toEqual([]));
  it('mock sign-in on a non-loopback listener, unless compose publishes on loopback only', () => {
    expect(startupProblems({ ...base, host: '0.0.0.0' })[0]).toMatch(/loopback/);
    expect(startupProblems({ ...base, host: '0.0.0.0', publish: 'loopback' })).toEqual([]);
  });
  it('a bad DEMO_MODE or LAB_ALLOWED_HOSTS stops startup', () => {
    expect(startupProblems({ ...base, modeRaw: 'both' }).join()).toMatch(/DEMO_MODE/);
    expect(startupProblems({ ...base, allowedHosts: ['bad host'] }).join()).toMatch(/LAB_ALLOWED_HOSTS/);
  });
  it('pf without PF_URL / PF_AUDIENCE, and with a plain-http remote', () => {
    expect(startupProblems({ ...base, idp: 'pf', mockSignin: false }).join()).toMatch(/PF_URL.*PF_AUDIENCE/);
    expect(startupProblems({ ...base, idp: 'pf', mockSignin: false, pfUrl: 'http://pf.example', pfIssuer: 'http://pf.example', pfJwksUrl: 'http://pf.example/pf/JWKS', pfAudience: 'a' }).join()).toMatch(/https/);
    const stub = { ...base, idp: 'pf', mockSignin: false, pfUrl: 'http://stub-issuer:9031', pfIssuer: 'http://stub-issuer:9031', pfJwksUrl: 'http://stub-issuer:9031/pf/JWKS', pfAudience: 'a' };
    expect(startupProblems(stub).join()).toMatch(/https/);
    expect(startupProblems({ ...stub, pfHttpHosts: ['stub-issuer'], pfAuthClientId: 'c', pfAuthClientSecret: 's', pfAuthRedirectUri: 'http://stub-issuer:9031/cb' })).toEqual([]);
    expect(startupProblems({ ...stub, pfHttpHosts: ['other'] }).join()).toMatch(/https/);
  });
  it('clean configs have no problems', () => {
    expect(startupProblems(base)).toEqual([]);
    expect(startupProblems({ ...base, idp: 'pf', mockSignin: false, nodeEnv: 'production', host: '0.0.0.0', pfUrl: 'https://pf.example', pfIssuer: 'https://pf.example', pfJwksUrl: 'https://pf.example/pf/JWKS', pfAudience: 'a', pfAuthClientId: 'c', pfAuthClientSecret: 's', pfAuthRedirectUri: 'https://pf.example/cb' })).toEqual([]);
  });
  const entry = fileURLToPath(new URL('../../src/index.js', import.meta.url));
  const run = (env) => spawnSync(process.execPath, [entry], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 15000 });
  it('the process exits 1 for an unknown DEMO_MODE (spawned)', () => {
    const r = run({ DEMO_MODE: 'both', STANDALONE_ENV: '/nonexistent/none.env', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'pd-x-')) });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing to start/);
  });
  it('the process exits 1 for mock sign-in on 0.0.0.0 and for live mode without settings (spawned)', () => {
    const base = { STANDALONE_ENV: '/nonexistent/none.env', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'pd-x-')) };
    expect(run({ ...base, ALLOW_MOCK_SIGNIN: '1', HOST: '0.0.0.0' }).status).toBe(1);
    expect(run({ ...base, DEMO_MODE: 'live', NODE_ENV: 'production' }).status).toBe(1);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApp, signedIn, tmpDir } from './helpers.js';
import { assertTrace } from '../../src/gatewayTrace.js';

// "What Privilege did" (Rule 25): the console's tool call carries a mock trace (the lab's own PEP computed every decision: checked),
// and the real gateway check carries a real trace (inferred or observed, never checked). Fake keys are built at run time.
const fare = (amount) => ({ flightId: 'FL200', amount });
const callOf = (agent, body) => agent.post('/api/tools/call?envelope=1').send(body);
const byId = (trace, id) => trace.decisions.find((d) => d.id === id);

describe('console tool call: a mock trace from the simulated gateway (the PEP)', () => {
  it('allow: every decision checked, the request is what the console sent, the response is the outcome shown, assertTrace is clean', async () => {
    const ctx = mockApp();
    const mary = await signedIn(ctx, 'mary');
    const sent = { tool: 'search_flights', args: { query: 'SFO to JFK' } };
    const r = await callOf(mary, sent);
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('allow');
    expect(r.body.exchanges).toHaveLength(1);
    const ex = r.body.exchanges[0];
    expect(ex).toMatchObject({ step: 1, status: 200 });
    const t = ex.trace;
    expect(assertTrace(t)).toEqual([]);
    expect(t.source).toBe('mock');
    expect(t.decisions.every((d) => d.basis === 'checked')).toBe(true);
    expect(t.decisions.map((d) => [d.id, d.outcome])).toEqual([['signed-in', 'pass'], ['tool', 'pass'], ['arguments', 'pass'], ['policy', 'pass'], ['ran', 'pass']]);
    expect(t.request.body).toEqual(sent);
    expect(t.request.url).toMatch(/\.invalid\//);
    const { exchanges, ...shown } = r.body;
    expect(t.response.body).toEqual(shown);
    expect(t.response.headers.traceparent).toBe(r.headers.traceparent);
    expect(byId(t, 'policy').evidence).toContain(r.body.rule);
  });

  it('deny: the policy decision fails with the deciding rule and nothing ran', async () => {
    const ctx = mockApp();
    const mary = await signedIn(ctx, 'mary');
    const r = await callOf(mary, { tool: 'pay_invoice', args: { invoiceId: 'INV-1', amount: 50 } });
    const t = r.body.exchanges[0].trace;
    expect(assertTrace(t)).toEqual([]);
    expect(byId(t, 'policy')).toMatchObject({ outcome: 'fail', basis: 'checked' });
    expect(byId(t, 'policy').evidence).toContain('default-deny');
    expect(byId(t, 'ran').outcome).toBe('skipped');
    expect(t.response.status).toBe(200); // ?envelope=1: the refusal is in the body
  });

  it('hold: the policy decision is info (a hold is never counted as passed) and the approvers are named', async () => {
    const ctx = mockApp();
    const mark = await signedIn(ctx, 'mark');
    const r = await callOf(mark, { tool: 'book_fare', args: fare(2400), asAgent: true });
    expect(r.body.outcome).toBe('hold');
    const t = r.body.exchanges[0].trace;
    expect(assertTrace(t)).toEqual([]);
    expect(byId(t, 'policy')).toMatchObject({ outcome: 'info', basis: 'checked' });
    expect(byId(t, 'policy').evidence).toContain(r.body.approvers[0]);
    expect(byId(t, 'ran').outcome).toBe('skipped');
    expect(t.request.body.asAgent).toBe(true);
  });

  it('unknown tool and invalid arguments stop before the policy runs', async () => {
    const ctx = mockApp();
    const mary = await signedIn(ctx, 'mary');
    const unknown = (await callOf(mary, { tool: 'no_such_tool', args: {} })).body.exchanges[0].trace;
    expect(assertTrace(unknown)).toEqual([]);
    expect(unknown.decisions.map((d) => d.outcome)).toEqual(['pass', 'fail', 'skipped', 'skipped', 'skipped']);
    const bad = (await callOf(mary, { tool: 'book_fare', args: { flightId: 5 } })).body.exchanges[0].trace;
    expect(assertTrace(bad)).toEqual([]);
    expect(bad.decisions.map((d) => d.outcome)).toEqual(['pass', 'pass', 'fail', 'skipped', 'skipped']);
    expect(byId(bad, 'arguments').evidence.length).toBeGreaterThan(10);
  });

  it('the sign-in cookie value is never in the trace; the request shows a placeholder', async () => {
    const ctx = mockApp();
    const agent = request.agent(ctx.app);
    const login = await agent.post('/api/auth/mock/login').send({ persona: 'mary' });
    const cookie = /^[^=]+=([^;]+)/.exec(String(login.headers['set-cookie']?.[0]))?.[1];
    expect(cookie && cookie.length).toBeGreaterThan(10); // the test must have a real cookie value to look for
    const r = await callOf(agent, { tool: 'search_flights', args: { query: 'x' } });
    expect(JSON.stringify(r.body)).not.toContain(cookie);
    expect(r.body.exchanges[0].trace.request.headers.cookie).toMatch(/kept on the server/);
    expect(r.body.exchanges[0].trace.request.headers).not.toHaveProperty('authorization');
  });

  it('without ?envelope=1 the answer is unchanged: no exchanges, the HTTP status carries the outcome', async () => {
    const ctx = mockApp();
    const mary = await signedIn(ctx, 'mary');
    const r = await mary.post('/api/tools/call').send({ tool: 'pay_invoice', args: { invoiceId: 'INV-1', amount: 50 } });
    expect(r.status).toBe(403);
    expect(r.body.exchanges).toBeUndefined();
  });

  it('the same decisions passed off as a real trace are refused by assertTrace (checked is for a simulation only)', async () => {
    const ctx = mockApp();
    const mary = await signedIn(ctx, 'mary');
    const t = (await callOf(mary, { tool: 'search_flights', args: { query: 'x' } })).body.exchanges[0].trace;
    expect(assertTrace({ ...t, source: 'real' }).some((p) => /cannot say "checked"/.test(p))).toBe(true);
  });
});

// ---- the real hop: a throwaway settings file and a stub fetch standing in for the gateway (nothing leaves the process) ----
const KEY = `pdk-${randomBytes(12).toString('hex')}`;
const SESSION = `sess-${randomBytes(12).toString('hex')}`;
let saved;
beforeEach(() => {
  saved = Object.fromEntries(Object.entries(process.env).filter(([k]) => k === 'STANDALONE_ENV' || k.startsWith('PDG_GW_')));
  for (const k of Object.keys(saved)) delete process.env[k];
  const file = path.join(tmpDir(), 'settings.env');
  fs.writeFileSync(file, `PDG_GW_URL=https://gateway.example/door\nPDG_GW_APPS=travel-door\nPDG_GW_KEY_TRAVEL_AGENT=${KEY}\n`);
  process.env.STANDALONE_ENV = file;
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(process.env)) if (k === 'STANDALONE_ENV' || k.startsWith('PDG_GW_')) delete process.env[k];
  Object.assign(process.env, saved);
});

// The stub gateway: `onCall(method, params)` answers a tools/* call as { status, body }.
const stubGateway = (onCall) => {
  const seen = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method, auth: init.headers?.Authorization });
    if (init.method === 'DELETE') return new Response(null, { status: 200 });
    const msg = JSON.parse(init.body);
    const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
    if (msg.method === 'initialize') return json(200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'stub-door', version: '1' }, capabilities: {} } }, { 'mcp-session-id': SESSION });
    if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const { status, body } = onCall(msg.method, msg.params, msg.id);
    return json(status, body);
  }));
  return seen;
};
const check = (ctx) => request(ctx.app).post('/api/gateway-check').send({});

describe('POST /api/gateway-check: a real trace from the shared hop capture', () => {
  it('listing ok and the probe refused (403): observed or inferred only, request and response exact, no key anywhere, assertTrace clean', async () => {
    const seen = stubGateway((method, params, id) => method === 'tools/list'
      ? { status: 200, body: { jsonrpc: '2.0', id, result: { tools: [{ name: 'search_flights', description: 'Search' }, { name: 'book_fare', description: 'Book' }] } } }
      : { status: 403, body: { error: 'forbidden', message: 'refused by policy' } });
    const r = await check(mockApp());
    expect(r.status).toBe(200);
    expect(seen.some((s) => s.auth === `Bearer ${KEY}`)).toBe(true); // the key really went to the gateway
    expect(r.body.listing.wire).toBeUndefined();
    expect(r.body.listing).toMatchObject({ ok: true });
    expect(r.body.refusal.ok).toBe(false);
    expect(r.body.exchanges.map((e) => [e.step, e.status])).toEqual([[1, 200], [2, 403]]);
    for (const e of r.body.exchanges) {
      expect(assertTrace(e.trace)).toEqual([]);
      expect(e.trace.source).toBe('real');
      expect(e.trace.decisions.some((d) => d.basis === 'checked')).toBe(false);
      expect(e.trace.setup.length).toBeGreaterThan(0);
    }
    const [list, probe] = r.body.exchanges.map((e) => e.trace);
    expect(list.request.body).toMatchObject({ method: 'tools/list' });
    expect(list.response.body.result.tools).toHaveLength(2);
    expect(byId(list, 'grant').evidence).toContain('search_flights');
    expect(probe.request.body).toMatchObject({ method: 'tools/call', params: { name: 'privilege_demo_refusal_probe_tool' } });
    expect(byId(probe, 'authenticated')).toMatchObject({ outcome: 'pass', basis: 'inferred' });
    expect(byId(probe, 'grant')).toMatchObject({ outcome: 'fail', basis: 'inferred' });
    const everything = JSON.stringify(r.body) + JSON.stringify(r.headers);
    for (const secret of [KEY, KEY.slice(0, 10), SESSION]) expect(everything).not.toContain(secret);
    expect(list.request.headers.Authorization ?? list.request.headers.authorization).toMatch(/kept on the server/);
  });

  it('an aggregate door (namespaced tools): the probe borrows the listed server prefix, so the gateway can refuse it by policy', async () => {
    const called = [];
    stubGateway((method, params, id) => {
      if (method === 'tools/list') return { status: 200, body: { jsonrpc: '2.0', id, result: { tools: [{ name: 'travel-mcp__search_flights', description: 'Search' }] } } };
      called.push(params.name);
      return { status: 403, body: { error: 'forbidden', message: 'refused by policy' } };
    });
    const r = await check(mockApp());
    expect(r.status).toBe(200);
    expect(called).toEqual(['travel-mcp__privilege_demo_refusal_probe_tool']);
    expect(r.body.refusal.ok).toBe(false);
    expect(r.body.exchanges.map((e) => [e.step, e.status])).toEqual([[1, 200], [2, 403]]);
  });

  it('a 401 on the handshake: the key check fails (inferred), the grant is not reached, and there is no probe', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => (init.method === 'DELETE' ? new Response(null, { status: 200 }) : new Response('{"error":"unauthorized"}', { status: 401, headers: { 'content-type': 'application/json' } }))));
    const r = await check(mockApp());
    expect(r.status).toBe(200);
    expect(r.body.listing.ok).toBe(false);
    expect(r.body.refusal).toBeUndefined();
    expect(r.body.exchanges).toHaveLength(1);
    const t = r.body.exchanges[0].trace;
    expect(assertTrace(t)).toEqual([]);
    expect(t.decisions.map((d) => [d.id, d.outcome, d.basis])).toEqual([['authenticated', 'fail', 'inferred'], ['grant', 'skipped', 'inferred']]);
    expect(JSON.stringify(r.body)).not.toContain(KEY);
  });

  it('a key echoed in a reply is scrubbed from the trace', async () => {
    stubGateway((method, params, id) => ({ status: 200, body: { jsonrpc: '2.0', id, result: { tools: [], echo: `your key ${KEY}` } } }));
    const r = await check(mockApp());
    expect(JSON.stringify(r.body)).not.toContain(KEY);
    for (const e of r.body.exchanges) expect(assertTrace(e.trace)).toEqual([]);
  });
});

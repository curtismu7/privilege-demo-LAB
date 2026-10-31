import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createNetguard, NetguardRefused } from '../../src/netguard.js';
import { makeApp, mockApp, pfApp, startStubPf, signedIn, bearer, rpc, tmpDir } from './helpers.js';

const refused = async (fn) => { try { await fn(); return false; } catch (e) { return e instanceof NetguardRefused; } };

describe('netguard: mock mode opens no socket', () => {
  it('refuses every URL, loopback included, and never calls the real fetch', async () => {
    const real = vi.fn();
    const g = createNetguard({ mode: () => 'mock', liveOrigin: () => 'https://pf.example', realFetch: real });
    for (const url of ['https://pf.example/pf/JWKS', 'https://other.invalid/', 'http://127.0.0.1:9/', 'not a url']) expect(await refused(() => g.fetchImpl(url)), url).toBe(true);
    expect(real).not.toHaveBeenCalled();
    expect(g.stats()).toEqual({ realAttempts: 0, refused: 4 });
  });

  it('the self-test passes on a sound guard and leaves the counters as they were', async () => {
    const real = vi.fn();
    const g = createNetguard({ mode: () => 'mock', liveOrigin: () => 'https://pf.example', realFetch: real });
    const r = await g.selfTest();
    expect(r.ok).toBe(true);
    expect(r.checks.length).toBeGreaterThanOrEqual(4);
    expect(g.stats()).toEqual({ realAttempts: 0, refused: 0 });
    expect(real).not.toHaveBeenCalled();
  });

  it('mutation proof: with the mock-mode refusal removed from netguard.js, the self-test fails and the real fetch is reached', async () => {
    const source = fs.readFileSync(new URL('../../src/netguard.js', import.meta.url), 'utf8');
    const refusalLine = "if (mode() !== 'live') refuse('Mock mode: no outbound calls');";
    expect(source).toContain(refusalLine); // the mutation target exists
    const dir = tmpDir();
    const mutated = path.join(dir, 'netguard-mutant.mjs');
    fs.writeFileSync(mutated, source.replace(refusalLine, '/* mutation: mock mode lets requests through */'));
    const { createNetguard: Mutant } = await import(pathToFileURL(mutated).href);
    const real = vi.fn(async () => ({ ok: true }));
    const leaky = Mutant({ mode: () => 'mock', liveOrigin: () => 'https://pf.example', realFetch: real });
    const r = await leaky.selfTest();
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => /configured PingFederate origin/.test(c.name)).ok).toBe(false);
    await leaky.fetchImpl('https://pf.example/pf/JWKS'); // and a mock-mode request now reaches the real fetch
    expect(real).toHaveBeenCalled();
    real.mockClear();
    // The sound guard, same inputs, does not.
    const sound = createNetguard({ mode: () => 'mock', liveOrigin: () => 'https://pf.example', realFetch: real });
    expect(await refused(() => sound.fetchImpl('https://pf.example/pf/JWKS'))).toBe(true);
    expect(real).not.toHaveBeenCalled();
  });

  it('the app exposes its netguard and the self-test passes on it', async () => {
    const ctx = mockApp({}, { fetchImpl: vi.fn() });
    expect((await ctx.app.locals.netguard.selfTest()).ok).toBe(true);
  });
});

describe('netguard: live mode reaches only the configured PingFederate', () => {
  it('passes the configured origin (no redirects followed, time cap set) and refuses everything else', async () => {
    const real = vi.fn(async () => ({ ok: true }));
    const g = createNetguard({ mode: () => 'live', liveOrigin: () => 'https://pf.example', realFetch: real });
    await g.fetchImpl('https://pf.example/pf/JWKS', { method: 'GET' });
    expect(real).toHaveBeenCalledTimes(1);
    expect(real.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(real.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    for (const url of ['https://evil.invalid/pf/JWKS', 'http://pf.example/pf/JWKS', 'https://pf.example.evil.invalid/', 'https://user:pw@pf.example/']) expect(await refused(() => g.fetchImpl(url)), url).toBe(true);
    expect(real).toHaveBeenCalledTimes(1);
    expect((await g.selfTest()).ok).toBe(true);
  });

  it('with no configured origin, live mode reaches nothing', async () => {
    const real = vi.fn();
    const g = createNetguard({ mode: () => 'live', liveOrigin: () => null, realFetch: real });
    expect(await refused(() => g.fetchImpl('https://pf.example/'))).toBe(true);
    expect(real).not.toHaveBeenCalled();
  });
});

describe('the whole app in mock mode makes zero outbound attempts', () => {
  it('sign-in, the tool console, approvals, a mock token, /mcp, preflight and health never reach the real fetch', async () => {
    const real = vi.fn(async () => { throw new Error('a real fetch was attempted'); });
    const ctx = makeApp({ mockSignin: true, host: '127.0.0.1', pfUrl: 'https://pf.example', pfIssuer: 'https://pf.example', pfJwksUrl: 'https://pf.example/pf/JWKS', pfAudience: 'a' }, { fetchImpl: real });
    const mark = await signedIn(ctx, 'mark');
    expect((await mark.post('/api/tools/call').send({ tool: 'book_fare', args: { flightId: 'F', amount: 2400 }, asAgent: true })).status).toBe(202);
    const token = (await mark.post('/api/mock/token').send({})).body.access_token;
    expect(token).toBeTruthy();
    const init = await rpc(request(ctx.app), token, 'tools/list', {});
    expect(init.status).toBe(200);
    expect((await request(ctx.app).get('/api/preflight')).status).toBe(200);
    expect((await request(ctx.app).get('/api/health')).status).toBe(200);
    // A PingFederate-looking token in mock mode is checked against the mock key only: no JWKS fetch.
    expect((await request(ctx.app).post('/mcp').set(bearer('a.b.c')).send({ jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
    expect(real).not.toHaveBeenCalled();
    expect(ctx.app.locals.netguard.stats()).toEqual({ realAttempts: 0, refused: 0 });
  });

  it('live mode with the stub PingFederate goes through the netguard and only to its origin', async () => {
    const pf = await startStubPf();
    try {
      const real = vi.fn((url, init) => fetch(url, init));
      const ctx = pfApp(pf, {}, { fetchImpl: real });
      expect((await request(ctx.app).get('/api/me').set(bearer(await pf.mint()))).status).toBe(200);
      expect(real).toHaveBeenCalled();
      for (const [url] of real.mock.calls) expect(new URL(url).origin).toBe(pf.url);
    } finally { await pf.close(); }
  });
});

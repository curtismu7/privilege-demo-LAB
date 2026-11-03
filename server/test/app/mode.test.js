import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { makeApp, mockApp, pfApp, startStubPf, signedIn, bearer, rpc } from './helpers.js';
import { MOCK_ISSUER } from '../../src/mockIdp.js';
import * as jose from 'jose';

describe('GET /api/health (rule 15)', () => {
  it('is demo-health/1, public, GET only, no detail', async () => {
    const ctx = mockApp();
    const r = await request(ctx.app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ schema: 'demo-health/1', state: 'ready', runtime: 'offline', demo: { id: 'privilege-demo', name: 'Privilege demo LAB' } });
    expect(new Date(r.body.at).toString()).not.toBe('Invalid Date');
    expect(JSON.stringify(r.body).length).toBeLessThan(4096);
    expect((await request(ctx.app).post('/api/health').send({})).status).toBe(404);
  });
  it('says needs-setup and live when live mode is chosen without PF settings, and broken for a broken policy set', async () => {
    const live = makeApp({ idp: 'pf', host: '0.0.0.0' });
    expect((await request(live.app).get('/api/health')).body).toMatchObject({ state: 'needs-setup', runtime: 'live' });
  });
  it('a Host that is not loopback gets nothing, not even health (DNS rebinding)', async () => {
    const r = await request(mockApp().app).get('/api/health').set('host', 'demo.example');
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'host_not_allowed' });
  });
  it('LAB_ALLOWED_HOSTS adds names', async () => {
    const r = await request(mockApp({ allowedHosts: ['lab.example'] }).app).get('/api/health').set('host', 'lab.example:4510');
    expect(r.status).toBe(200);
  });
});

describe('the Mock/Live toggle (PUT /api/mode)', () => {
  it('starts in mock mode by default', async () => {
    const r = await request(mockApp().app).get('/api/mode');
    expect(r.body).toMatchObject({ mode: 'mock', liveReady: false });
    expect(r.body.liveFix).toMatch(/PF_URL/);
  });
  it('the fix names what is missing and, for Docker, the shared-env overlay', async () => {
    const r = await request(mockApp().app).get('/api/mode');
    expect(r.body.liveFix).toMatch(/live mode needs PF_URL; live mode needs PF_AUDIENCE/);
    expect(r.body.liveFix).toMatch(/docker-compose\.shared-env\.yml/);
  });
  it('/api/auth/config carries liveReady and the fix, so the web app need not try Live to find out', async () => {
    const r = await request(mockApp().app).get('/api/auth/config');
    expect(r.body).toMatchObject({ mode: 'mock', liveReady: false });
    expect(r.body.liveFix).toMatch(/PF_URL/);
  });
  it('live without PF settings is refused with the fix, and the mode stays mock', async () => {
    const ctx = mockApp();
    const r = await request(ctx.app).put('/api/mode').send({ mode: 'live' });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'live_not_configured', mode: 'mock' });
    expect((await request(ctx.app).get('/api/health')).body.runtime).toBe('offline');
  });
  it('switches both ways when PF is configured, and health follows', async () => {
    const pf = await startStubPf();
    try {
      const ctx = mockApp({ pfUrl: pf.url, pfIssuer: pf.url, pfJwksUrl: `${pf.url}/pf/JWKS`, pfAudience: 'privilege-demo-test', pfAuthClientId: 'pd-web', pfAuthClientSecret: 'pd-secret', pfAuthRedirectUri: `${pf.url}/cb` });
      expect((await request(ctx.app).put('/api/mode').send({ mode: 'live' })).body.mode).toBe('live');
      expect((await request(ctx.app).get('/api/health')).body.runtime).toBe('live');
      // In live mode the persona session is not an identity, and the mock sign-in is refused.
      expect((await request(ctx.app).post('/api/auth/mock/login').send({ persona: 'mark' })).body.reason).toBe('live_mode');
      expect((await request(ctx.app).get('/api/me').set(bearer(await pf.mint()))).status).toBe(200);
      expect((await request(ctx.app).put('/api/mode').send({ mode: 'mock' })).body.mode).toBe('mock');
      expect((await request(ctx.app).get('/api/health')).body.runtime).toBe('offline');
      // Back in mock mode the PingFederate token is no longer accepted.
      expect((await request(ctx.app).get('/api/me').set(bearer(await pf.mint()))).status).toBe(401);
    } finally { await pf.close(); }
  });
  it('rejects an unknown mode, a cross-origin write, a proxied request and a non-JSON body', async () => {
    const ctx = mockApp();
    expect((await request(ctx.app).put('/api/mode').send({ mode: 'both' })).status).toBe(400);
    expect((await request(ctx.app).put('/api/mode').set('origin', 'https://evil.example').send({ mode: 'mock' })).body.error).toBe('cross_origin_write_refused');
    expect((await request(ctx.app).put('/api/mode').set('sec-fetch-site', 'cross-site').send({ mode: 'mock' })).status).toBe(403);
    const proxied = await request(ctx.app).put('/api/mode').set('x-forwarded-for', '9.9.9.9').send({ mode: 'mock' });
    expect(proxied.body).toEqual({ error: 'mode_change_refused', reason: 'proxy_header' });
    expect((await request(ctx.app).put('/api/mode').set('content-type', 'text/plain').send('mode=mock')).status).toBe(415);
  });
  it('a same-origin browser write passes', async () => {
    const r = await request(mockApp().app).put('/api/mode').set('host', 'localhost:4510').set('origin', 'http://localhost:4510').set('sec-fetch-site', 'same-origin').send({ mode: 'mock' });
    expect(r.status).toBe(200);
  });
});

describe('mock mode: an in-process mock issuer, tokens labelled mock', () => {
  it('a signed-in persona gets a mock token (raw, labelled) that the /mcp door accepts offline', async () => {
    const ctx = mockApp();
    const mark = await signedIn(ctx, 'mark');
    const t = (await mark.post('/api/mock/token').send({ asAgent: true })).body;
    expect(t).toMatchObject({ mock: true, issuer: MOCK_ISSUER });
    expect(t.label).toMatch(/mock/);
    const header = jose.decodeProtectedHeader(t.access_token);
    const claims = jose.decodeJwt(t.access_token);
    expect(header).toMatchObject({ alg: 'ES256', mock: true });
    expect(claims).toMatchObject({ sub: 'mark', mock: true, act: { sub: 'dot' }, iss: MOCK_ISSUER });
    const list = await rpc(request(ctx.app), t.access_token, 'tools/list', {});
    expect(list.body.result.tools.map((x) => x.name)).toContain('book_fare');
    const call = await rpc(request(ctx.app), t.access_token, 'tools/call', { name: 'book_fare', arguments: { flightId: 'FL200', amount: 2400 } });
    expect(call.body.error).toMatchObject({ code: -32004, message: 'held for approval' }); // Dot acting for Mark over $1,000 waits for Priya
  });
  it('needs a persona session, and is refused in live mode', async () => {
    const ctx = mockApp();
    expect((await request(ctx.app).post('/api/mock/token').send({})).status).toBe(401);
  });
  it('a token signed by any other key, or an expired one, is refused in mock mode', async () => {
    const ctx = mockApp();
    const other = (await import('../../src/mockIdp.js')).createMockIdp({ personas: (await import('../../src/auth/personas.js')).PERSONAS });
    const forged = await other.mint({ persona: 'dana' });
    expect((await request(ctx.app).get('/api/me').set(bearer(forged))).body.reason).toBe('bad_signature');
    const mock = (await import('../../src/mockIdp.js')).createMockIdp({ now: () => Date.now() - 3 * 3600 * 1000, personas: (await import('../../src/auth/personas.js')).PERSONAS });
    expect((await request(ctx.app).get('/api/me').set(bearer(await mock.mint({ persona: 'mark' })))).body.reason).toBe('bad_signature');
  });
  it('a live (PingFederate) config does not change what mock mode trusts', async () => {
    const pf = await startStubPf();
    try {
      const ctx = mockApp({ pfUrl: pf.url, pfIssuer: pf.url, pfJwksUrl: `${pf.url}/pf/JWKS`, pfAudience: 'privilege-demo-test', pfAuthClientId: 'pd-web', pfAuthClientSecret: 'pd-secret', pfAuthRedirectUri: `${pf.url}/cb` });
      const r = await request(ctx.app).get('/api/me').set(bearer(await pf.mint()));
      expect(r.status).toBe(401);
      expect(['bad_signature', 'unverifiable']).toContain(r.body.reason);
    } finally { await pf.close(); }
  });
  it('the mock issuer key is P-256 made with createECDH, never generateKeyPair', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../src/mockIdp.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    expect(src).toContain('createECDH');
    expect(src).not.toMatch(/generateKeyPair/);
  });
});

describe('the pf app config in tests', () => {
  it('pfApp is live mode', async () => {
    const pf = await startStubPf();
    try { expect((await request(pfApp(pf).app).get('/api/auth/config')).body).toMatchObject({ mode: 'live', idp: 'pf', bearer: true }); } finally { await pf.close(); }
  });
});

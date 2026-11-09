import fs from 'node:fs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { makeApp, mockApp, signedIn } from './helpers.js';
import { mockRequestRefusal, proxyHeaderPresent } from '../../src/auth/guards.js';

const login = (app, persona = 'mark', headers = {}) => request(app).post('/api/auth/mock/login').set(headers).send({ persona });

describe('mock sign-in: the routes exist only behind both switches', () => {
  it('IDP=local-mock without ALLOW_MOCK_SIGNIN=1: route absent', async () => {
    const { app } = makeApp({ idp: 'local-mock', mockSignin: false });
    expect((await login(app)).status).toBe(404);
    expect((await request(app).get('/api/auth/mock/personas')).status).toBe(404);
  });
  it('config() allows mock sign-in only for the literal ALLOW_MOCK_SIGNIN=1, and live mode refuses it per request', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { DEMO_MODE: 'live', ALLOW_MOCK_SIGNIN: '1' });
    try {
      const { config } = await import('../../src/config.js');
      expect(config()).toMatchObject({ mode: 'live', idp: 'pf', mockSignin: true });
      process.env.ALLOW_MOCK_SIGNIN = 'true';
      expect(config().mockSignin).toBe(false); // only the literal 1
      delete process.env.DEMO_MODE;
      expect(config()).toMatchObject({ mode: 'mock', idp: 'local-mock' }); // mock is the default
    } finally { for (const k of ['DEMO_MODE', 'ALLOW_MOCK_SIGNIN']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
    expect(mockRequestRefusal({ headers: { host: 'localhost' }, socket: { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' } }, { mockSignin: true, host: '127.0.0.1' }, 'live')).toBe('live_mode');
  });
  it('lists personas and signs Mark in; /api/me shows his groups', async () => {
    const ctx = mockApp();
    const list = await request(ctx.app).get('/api/auth/mock/personas');
    expect(list.body.personas.map((p) => p.id)).toEqual(['mark', 'mary', 'priya']);
    const mark = await signedIn(ctx, 'mark');
    const me = await mark.get('/api/me');
    expect(me.body).toMatchObject({ sub: 'mark', groups: ['travel-agents'], isAdmin: false, source: 'session' });
  });
  it('unknown persona is 404, no session cookie is set', async () => {
    const r = await login(mockApp().app, 'eve');
    expect(r.status).toBe(404);
    expect(r.headers['set-cookie']).toBeUndefined();
  });
});

describe('mock sign-in refusals', () => {
  it('NODE_ENV=production is not a guard: the Docker images set it, and mock sign-in is allowed there on a loopback bind', async () => {
    const r = await login(mockApp({ nodeEnv: 'production' }).app);
    expect(r.status).toBe(200);
  });
  it('refuses when the listener is not loopback (unless compose says the port is published on loopback only)', async () => {
    const r = await login(mockApp({ host: '0.0.0.0' }).app);
    expect(r.body.reason).toBe('non_loopback_listener');
    expect((await login(mockApp({ host: '0.0.0.0', publish: 'loopback' }).app)).status).toBe(200);
  });
  it('refuses in live mode', async () => {
    const r = await login(mockApp({ idp: 'pf', pfUrl: 'https://pf.example', pfIssuer: 'https://pf.example', pfJwksUrl: 'https://pf.example/pf/JWKS', pfAudience: 'a' }).app);
    expect(r.body).toEqual({ error: 'mock_signin_refused', reason: 'live_mode' });
  });
  it.each(['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'cf-connecting-ip', 'cf-ray', 'true-client-ip', 'via'])(
    'refuses when proxy header %s is present', async (h) => {
      const r = await login(mockApp().app, 'mark', { [h]: '1.2.3.4' });
      expect(r.status).toBe(403);
      expect(r.body.reason).toBe('proxy_header');
    });
  describe('behind the lab-proxy: forwarded headers are tolerated ONLY on a LAB_ALLOWED_HOSTS Host (owner, 2026-11-08)', () => {
    const PROXY_HOST = 'privilege-demo.local.ping-devops.com:4510';
    const fwd = { 'x-forwarded-host': 'local.ping-devops.com:8443', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9' };
    const ORIGIN = { origin: 'https://local.ping-devops.com:8443' };
    const proxied = () => mockApp({ allowedHosts: ['privilege-demo.local.ping-devops.com'] });
    const sock = { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' };
    const cfg = { mockSignin: true, host: '127.0.0.1', allowedHosts: ['privilege-demo.local.ping-devops.com'] };
    it('mock sign-in, the mode toggle and the script reset work on the listed Host with the proxy headers', async () => {
      const c = proxied();
      const headers = { host: PROXY_HOST, ...fwd, ...ORIGIN };
      expect((await login(c.app, 'mark', headers)).status).toBe(200);
      expect((await request(c.app).put('/api/mode').set(headers).send({ mode: 'mock' })).status).toBe(200);
      expect((await request(c.app).post('/api/workspaces/alpha/reset').set(headers).send({})).status).toBe(200);
      expect((await request(c.app).get('/api/auth/config').set(headers)).body.mockAvailable).toBe(true);
    });
    it('a session made behind the proxy keeps working behind the proxy', async () => {
      const c = proxied();
      const headers = { host: PROXY_HOST, ...fwd, ...ORIGIN };
      const agent = request.agent(c.app);
      expect((await agent.post('/api/auth/mock/login').set(headers).send({ persona: 'mark' })).status).toBe(200);
      expect((await agent.get('/api/me').set(headers)).status).toBe(200);
    });
    it('a loopback Host with forwarded headers is still refused, even when LAB_ALLOWED_HOSTS is set', async () => {
      const c = proxied();
      for (const host of ['127.0.0.1:4510', 'localhost:4510']) {
        const r = await login(c.app, 'mark', { host, ...fwd }); // no Origin, so the same-origin write check passes and the guard itself answers
        expect([host, r.status, r.body.reason]).toEqual([host, 403, 'proxy_header']);
        const m = await request(c.app).put('/api/mode').set({ host, ...fwd }).send({ mode: 'mock' });
        expect([host, m.status, m.body.reason]).toEqual([host, 403, 'proxy_header']);
        expect((await request(c.app).post('/api/workspaces/alpha/reset').set({ host, ...fwd }).send({})).status).toBe(403);
      }
      expect(mockRequestRefusal({ headers: { host: 'localhost:4510', ...fwd }, socket: sock }, cfg)).toBe('proxy_header');
    });
    it('a Host that is not listed, with forwarded headers, is refused (unit, and over HTTP by the Host check)', async () => {
      const req = (host) => ({ headers: { host, ...fwd }, socket: sock });
      expect(mockRequestRefusal(req('other.example:4510'), cfg)).toBe('proxy_header');
      expect(mockRequestRefusal(req('other.example:4510'), { ...cfg, allowedHosts: [] })).toBe('proxy_header');
      expect(mockRequestRefusal(req(PROXY_HOST), { ...cfg, allowedHosts: [] })).toBe('proxy_header'); // LAB_ALLOWED_HOSTS unset
      expect(mockRequestRefusal(req(PROXY_HOST), cfg)).toBeNull();
      expect((await login(proxied().app, 'mark', { host: 'other.example:4510', ...fwd, ...ORIGIN })).status).toBe(403);
    });
    it('the other refusals still apply on the listed Host with forwarded headers', () => {
      const req = (socket = sock) => ({ headers: { host: PROXY_HOST, ...fwd }, socket });
      expect(mockRequestRefusal(req({ localAddress: '10.0.0.5', remoteAddress: '10.0.0.9' }), cfg)).toBe('non_loopback_connection');
      expect(mockRequestRefusal(req(), { ...cfg, mockSignin: false })).toBe('disabled');
      expect(mockRequestRefusal(req(), cfg, 'live')).toBe('live_mode');
    });
  });
  it('refuses a non-loopback Host header (DNS rebinding): the Host check answers first, and the guard says so too', async () => {
    const r = await login(mockApp().app, 'mark', { host: 'demo.example' });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'host_not_allowed' });
    const req = { headers: { host: 'demo.example' }, socket: { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' } };
    expect(mockRequestRefusal(req, { mockSignin: true, host: '127.0.0.1' })).toBe('non_loopback_host');
  });
  it('refuses a non-loopback connection (unit: fake sockets)', () => {
    const cfg = { mockSignin: true, host: '127.0.0.1' };
    const req = (local, remote) => ({ headers: { host: 'localhost' }, socket: { localAddress: local, remoteAddress: remote } });
    expect(mockRequestRefusal(req('127.0.0.1', '127.0.0.1'), cfg)).toBeNull();
    expect(mockRequestRefusal(req('::ffff:127.0.0.1', '::1'), cfg)).toBeNull();
    expect(mockRequestRefusal(req('10.0.0.5', '10.0.0.9'), cfg)).toBe('non_loopback_connection');
    expect(mockRequestRefusal(req('127.0.0.1', '192.168.1.4'), cfg)).toBe('non_loopback_connection');
    expect(mockRequestRefusal({ headers: {}, socket: {} }, cfg)).toBe('non_loopback_connection');
  });
  it('proxyHeaderPresent is case-insensitive and ignores ordinary headers', () => {
    expect(proxyHeaderPresent({ 'X-Forwarded-For': 'x' })).toBe(true);
    expect(proxyHeaderPresent({ accept: '*/*', host: 'localhost', cookie: 'a=b' })).toBe(false);
  });
  it('/api/session is always 200: me is null when nobody (or a bad cookie or a proxied request) is signed in, the same view as /api/me otherwise', async () => {
    const ctx = mockApp();
    expect((await request(ctx.app).get('/api/session')).body).toEqual({ me: null });
    expect((await request(ctx.app).get('/api/session').set('cookie', 'pd_session=abc.def')).status).toBe(200);
    const mark = await signedIn(ctx, 'mark');
    const session = await mark.get('/api/session');
    expect(session.status).toBe(200);
    expect(session.body.me).toEqual((await mark.get('/api/me')).body);
    const proxied = await mark.get('/api/session').set('x-forwarded-for', '9.9.9.9');
    expect(proxied.status).toBe(200);
    expect(proxied.body).toEqual({ me: null });
    expect((await request(ctx.app).get('/api/me')).status).toBe(401); // the API door itself still says 401
  });
  it('a session cookie stops working once a proxy header appears', async () => {
    const ctx = mockApp();
    const mark = await signedIn(ctx, 'mark');
    expect((await mark.get('/api/me')).status).toBe(200);
    expect((await mark.get('/api/me').set('x-forwarded-for', '9.9.9.9')).status).toBe(401);
  });
  it('a tampered or expired session cookie is rejected', async () => {
    const ctx = mockApp();
    const mark = await signedIn(ctx, 'mark');
    const cookie = (await request(ctx.app).post('/api/auth/mock/login').send({ persona: 'mark' })).headers['set-cookie'][0].split(';')[0];
    const forged = cookie.replace(/\.[^.]+$/, '.AAAA');
    expect((await request(ctx.app).get('/api/me').set('cookie', forged)).status).toBe(401);
    ctx.clock.t += 9 * 3600 * 1000;
    expect((await mark.get('/api/me')).status).toBe(401);
  });
  it('logout clears the session', async () => {
    const ctx = mockApp();
    const mark = await signedIn(ctx, 'mark');
    await mark.post('/api/auth/logout');
    expect((await mark.get('/api/me')).status).toBe(401);
  });
});

describe('the admin persona', () => {
  it('does not exist without the switch file: not listed, login is 404', async () => {
    const ctx = mockApp();
    expect((await request(ctx.app).get('/api/auth/mock/personas')).body.personas.map((p) => p.id)).not.toContain('dana');
    expect((await login(ctx.app, 'dana')).status).toBe(404);
  });
  it('exists with the switch file, and loses its session when the file goes away', async () => {
    const ctx = mockApp();
    const dana = await signedIn(ctx, 'dana');
    expect((await dana.get('/api/me')).body).toMatchObject({ sub: 'dana', isAdmin: true });
    fs.rmSync(ctx.cfg.adminSwitchFile);
    expect((await dana.get('/api/me')).status).toBe(401);
  });
});

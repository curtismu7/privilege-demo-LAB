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

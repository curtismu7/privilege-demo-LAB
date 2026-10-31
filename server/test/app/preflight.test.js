import fs from 'node:fs';
import http from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, mockApp, pfApp, startStubPf, bearer } from './helpers.js';

const failing = (body) => body.checks.filter((c) => !c.ok);
let pf;
beforeAll(async () => { pf = await startStubPf(); });
afterAll(() => pf.close());

describe('GET /api/preflight', () => {
  it('local-mock: all clear except the optional admin switch, which names its fix', async () => {
    const r = await request(mockApp().app).get('/api/preflight');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const bad = failing(r.body);
    expect(bad.map((c) => c.id)).toEqual(['admin-switch']);
    expect(bad[0]).toMatchObject({ level: 'warn' });
    expect(bad[0].fix).toContain('ALLOW_ADMIN_PERSONA');
  });
  it('local-mock with the admin switch file: nothing failing', async () => {
    const ctx = mockApp();
    fs.writeFileSync(ctx.cfg.adminSwitchFile, 'on');
    expect(failing((await request(ctx.app).get('/api/preflight')).body)).toEqual([]);
  });
  it('local-mock with mock sign-in off says to set ALLOW_MOCK_SIGNIN=1', async () => {
    const r = await request(makeApp().app).get('/api/preflight');
    expect(r.body.ok).toBe(false);
    expect(failing(r.body).find((c) => c.id === 'mock-signin').fix).toContain('ALLOW_MOCK_SIGNIN=1');
  });
  it('pf with a reachable stub JWKS: all clear', async () => {
    const r = await request(pfApp(pf).app).get('/api/preflight');
    expect(r.body).toMatchObject({ ok: true, idp: 'pf' });
    expect(failing(r.body)).toEqual([]);
  });
  it('pf without PF_URL / PF_AUDIENCE names both fixes', async () => {
    const r = await request(makeApp({ idp: 'pf', host: '0.0.0.0' }).app).get('/api/preflight');
    expect(r.body.ok).toBe(false);
    const fixes = failing(r.body).map((c) => c.fix).join(' ');
    expect(fixes).toContain('PF_URL');
    expect(fixes).toContain('PF_AUDIENCE');
  });
  it('pf with an unreachable JWKS names the fix', async () => {
    const ctx = pfApp(pf, { pfJwksUrl: 'http://127.0.0.1:9/pf/JWKS' });
    const r = await request(ctx.app).get('/api/preflight');
    expect(r.body.ok).toBe(false);
    expect(failing(r.body).find((c) => c.id === 'pf-jwks').fix).toMatch(/PF_URL/);
  });
  it('pf with a reachable JWKS that has no keys fails the JWKS check', async () => {
    const empty = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"keys":[]}'); });
    await new Promise((r) => empty.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${empty.address().port}`;
      const r = await request(pfApp({ url }, { pfJwksUrl: `${url}/pf/JWKS` }).app).get('/api/preflight');
      expect(failing(r.body).map((c) => c.id)).toEqual(['pf-jwks']);
    } finally { empty.closeAllConnections(); await new Promise((r) => empty.close(r)); }
  });
  it('never returns a configured URL, token or secret', async () => {
    const ctx = pfApp(pf, { sessionSecret: 'sentinel-session-secret' });
    const text = JSON.stringify((await request(ctx.app).get('/api/preflight')).body);
    expect(text).not.toContain(pf.url);
    expect(text).not.toContain('sentinel-session-secret');
  });
  it('a Bearer token on a server with no PF configured says how to fix it', async () => {
    const r = await request(mockApp().app).post('/mcp').set(bearer('a.b.c')).send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(r.status).toBe(401);
    expect(r.body.reason).toBe('bearer_not_enabled');
    expect(r.body.fix).toContain('PF_URL');
  });
});

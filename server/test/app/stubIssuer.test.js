// The local demonstration stub issuer (stub-issuer/) against the app's PF verifier. No shared services.
import http from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStubIssuer } from '../../../stub-issuer/server.mjs';
import { makeApp, bearer } from './helpers.js';

let stub;
let url;
let ctx;
const post = (path, body) => new Promise((resolve, reject) => {
  const req = http.request(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
    let out = '';
    res.on('data', (c) => { out += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(out) }));
  });
  req.on('error', reject);
  req.end(JSON.stringify(body));
});

beforeAll(async () => {
  // The issuer URL is only known after listen, so listen first on a port, then build the issuer with it.
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  url = `http://127.0.0.1:${port}`;
  stub = createStubIssuer({ issuer: url, audience: 'privilege-demo' });
  await new Promise((r) => stub.server.listen(port, '127.0.0.1', r));
  ctx = makeApp({ idp: 'pf', pfUrl: url, pfIssuer: url, pfJwksUrl: `${url}/pf/JWKS`, pfAudience: 'privilege-demo', host: '0.0.0.0' });
});
afterAll(() => new Promise((r) => { stub.server.closeAllConnections(); stub.server.close(r); }));

const mcp = (token, name, args) => request(ctx.app).post('/mcp').set(bearer(token)).send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

describe('stub issuer', () => {
  it('mints persona tokens the app accepts, with the persona groups', async () => {
    const { body } = await post('/mint', { persona: 'mary' });
    const r = await request(ctx.app).get('/api/me').set(bearer(body.access_token));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sub: 'mary', groups: ['analysts'], source: 'bearer' });
  });
  it('a tampered token is refused', async () => {
    const { body } = await post('/mint', { persona: 'mary' });
    const [h, p, s] = body.access_token.split('.');
    const bad = `${h}.${p}.${s.slice(0, 10)}${s[10] === 'A' ? 'B' : 'A'}${s.slice(11)}`;
    expect((await request(ctx.app).get('/api/me').set(bearer(bad))).status).toBe(401);
  });
  it('overrides: groups, scope and act (finance + payments:write pays; Dot makes it unattended)', async () => {
    const fin = (await post('/mint', { persona: 'mark', groups: ['finance'], scope: 'tools:invoke payments:write' })).body.access_token;
    expect((await mcp(fin, 'pay_invoice', { invoiceId: 'I1', amount: 5 })).body.result).toBeTruthy();
    const dot = (await post('/mint', { persona: 'mark', act: 'dot' })).body.access_token;
    expect((await mcp(dot, 'book_fare', { flightId: 'F1', amount: 2400 })).body.error.code).toBe(-32004); // held
  });
  it('rejects an unknown persona and unknown paths', async () => {
    expect((await post('/mint', { persona: 'nobody' })).status).toBe(400);
    expect((await post('/other', {})).status).toBe(404);
  });
  it('the JWKS holds only the public key', () => {
    expect(Object.keys(stub.jwks.keys[0]).sort()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
  });
});

// Rule: live sign-in (pi.flow). A real PingFederate login driven server-side: start posts the authorization
// request with response_mode=pi.flow, credentials post checkUsernamePassword, the completed flow's code is
// redeemed with PKCE, the access token is verified against the PF JWKS, and the subject signs the session.
// The stub PF here speaks discovery, pi.flow, the token endpoint and the JWKS on one loopback server.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { AUD, makeApp, tmpDir } from './helpers.js';
import * as jose from 'jose';
import { generateKeyPairSync, randomUUID } from 'node:crypto';


let pf; let ctx; let keyPair;
beforeAll(async () => {
  keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const { kty, n, e } = keyPair.publicKey.export({ format: 'jwk' });
  const jwks = { keys: [{ kty, n, e, kid: 'pf-1', alg: 'RS256', use: 'sig' }] };
  const flows = new Map(); // flowId -> { username, password, state, code, nonce }
  pf = http.createServer((req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const read = () => { let b = ''; req.on('data', (c) => { b += c; }); return new Promise((r) => req.on('end', () => r(b))); };
    (async () => {
      if (req.url === '/.well-known/openid-configuration') {
        const base = `http://127.0.0.1:${req.socket.localPort}`;
        return json(200, { issuer: base, authorization_endpoint: `${base}/as/authorization.oauth2`, token_endpoint: `${base}/as/token.oauth2` });
      }
      if (req.url === '/pf/JWKS') return json(200, jwks);
      if (req.url.startsWith('/as/authorization.oauth2')) {
        const u = new URL(req.url, 'https://pf.stub');
        if (u.searchParams.get('response_mode') !== 'pi.flow') return res.writeHead(400, { 'content-type': 'text/html' }).end('<html>login page</html>');
        const flowId = crypto.randomBytes(12).toString('hex');
        flows.set(flowId, { state: u.searchParams.get('state'), nonce: u.searchParams.get('nonce') });
        return json(200, { id: flowId, status: 'USERNAME_PASSWORD_REQUIRED', _links: { checkUsernamePassword: { href: `https://pf.stub/pf-ws/authn/flows/${flowId}` } } });
      }
      if (req.url.startsWith('/pf-ws/authn/flows/')) {
        const flowId = req.url.split('/').pop();
        const f = flows.get(flowId);
        const body = JSON.parse(await read() || '{}');
        if (!f) return json(404, { code: 'flow_gone' });
        if (body.username !== 'alice' || body.password !== 'correct-horse') return json(400, { details: [{ code: 'CREDENTIAL_VALIDATION_FAILED' }] });
        f.code = crypto.randomBytes(16).toString('hex');
        return json(200, { id: flowId, status: 'COMPLETED', authorizeResponse: { code: f.code, state: f.state } });
      }
      if (req.url === '/as/token.oauth2') {
        const form = new URLSearchParams(await read());
        const f = [...flows.values()].find((x) => x.code === form.get('code'));
        if (!f || form.get('grant_type') !== 'authorization_code') return json(400, { error: 'invalid_grant' });
        const now = Math.floor(Date.now() / 1000);
        const j = new jose.SignJWT({ sub: 'alice', groups: ['travel-agents'], scope: 'tools:invoke', client_id: 'pd-web' })
          .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'pf-1' }).setIssuer(`${req.headers.host === undefined ? 'x' : 'http://' + req.headers.host}`).setAudience(AUD)
          .setIssuedAt(now - 5).setExpirationTime(now + 300).setJti(randomUUID());
        const at = await j.sign(keyPair.privateKey);
        return json(200, { access_token: at, token_type: 'Bearer', expires_in: 300 });
      }
      res.writeHead(404); res.end();
    })().catch(() => { res.writeHead(500); res.end(); });
  });
  await new Promise((r) => pf.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${pf.address().port}`;
  const dir = tmpDir();
  ctx = makeApp({
    idp: 'pf', pfUrl: url, pfIssuer: url, pfJwksUrl: `${url}/pf/JWKS`, pfAudience: AUD,
    pfAuthClientId: 'pd-web', pfAuthClientSecret: 'pd-secret', pfAuthRedirectUri: `${url}/cb`, dataDir: dir,
  }, {});
  ctx.url = url;
});
afterAll(async () => { if (pf) await new Promise((r) => { pf.closeAllConnections(); pf.close(r); }); });

describe('live sign-in (pi.flow)', () => {
  test('the full real path: start opens a flow, credentials redeem a code, the verified claims sign the session', async () => {
    const agent = request.agent(ctx.app);
    const start = await agent.post('/api/auth/live/start');
    expect(start.status, 200);
    expect(start.body.status, 'USERNAME_PASSWORD_REQUIRED');
    const done = await agent.post('/api/auth/live/credentials').send({ username: 'alice', password: 'correct-horse' });
    expect(done.status, 200);
    expect(done.body.me.sub, 'alice');
    expect(done.body.me.source, 'bearer');
    // The session now answers /api/me like any signed-in user.
    const me = await agent.get('/api/session');
    expect(me.body.me.sub, 'alice');
    expect(me.body.me.groups.includes('travel-agents'), true);
  });

  test('wrong credentials are a 401 with the server reason, and no session is issued', async () => {
    const agent = request.agent(ctx.app);
    await agent.post('/api/auth/live/start');
    const bad = await agent.post('/api/auth/live/credentials').send({ username: 'alice', password: 'wrong' });
    expect(bad.status, 401);
    const me = await agent.get('/api/session');
    expect(me.body.me, null);
  });

  test('credentials without a started run are a 409, and a bad mode body is 400', async () => {
    const agent = request.agent(ctx.app);
    const noRun = await agent.post('/api/auth/live/credentials').send({ username: 'a', password: 'b' });
    expect(noRun.status, 409);
    const badBody = await agent.post('/api/auth/live/start').send({});
    expect(badBody.status).not.toBe(500);
  });

  test('in mock mode the live sign-in is refused (403)', async () => {
    const mock = makeApp({ mockSignin: true, idp: 'local-mock' }, {});
    const r = await request(mock.app).post('/api/auth/live/start');
    expect(r.status, 403);
  });
});

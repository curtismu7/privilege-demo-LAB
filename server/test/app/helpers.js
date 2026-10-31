// Test-only: app factory, a stub PingFederate (generated key pair + JWKS on loopback) and token minting. No shared services.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import * as jose from 'jose';
import request from 'supertest';
import { config } from '../../src/config.js';
import { createApp } from '../../src/app.js';

export const AUD = 'privilege-demo-test';
export const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pd-test-'));

export function makeApp(over = {}, opts = {}) {
  const clock = { t: Date.now() };
  const dataDir = over.dataDir || tmpDir();
  const cfg = { ...config(), dataDir, idp: 'local-mock', mockSignin: false, nodeEnv: '', adminSwitchFile: path.join(dataDir, 'ALLOW_ADMIN_PERSONA'), ...over };
  const app = createApp({ cfg, now: () => clock.t, ...opts });
  return { app, cfg, clock, dataDir };
}

export const mockApp = (over = {}) => makeApp({ mockSignin: true, host: '127.0.0.1', ...over });

// A signed-in supertest agent for a persona (cookie jar kept by the agent).
export async function signedIn(ctx, persona) {
  if (persona === 'dana') fs.writeFileSync(ctx.cfg.adminSwitchFile, 'on');
  const agent = request.agent(ctx.app);
  const r = await agent.post('/api/auth/mock/login').send({ persona });
  if (r.status !== 200) throw new Error(`login ${persona} -> ${r.status}`);
  return agent;
}

export async function startStubPf() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const { kty, n, e } = publicKey.export({ format: 'jwk' });
  const jwks = { keys: [{ kty, n, e, kid: 'pf-1', alg: 'RS256', use: 'sig' }] };
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/pf/JWKS' ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/pf/JWKS' ? jwks : {}));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const mint = (claims = {}, o = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const body = { sub: 'priya', groups: ['travel-agents'], scope: 'tools:invoke', client_id: 'dot-client', ...claims };
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
    let j = new jose.SignJWT(body).setProtectedHeader({ alg: o.alg || 'RS256', typ: 'at+jwt', kid: 'pf-1' })
      .setIssuer(o.iss ?? url).setAudience(o.aud ?? AUD).setIssuedAt(now - 10).setJti(randomUUID());
    j = j.setExpirationTime(o.exp ?? now + 300);
    if (o.nbf) j = j.setNotBefore(o.nbf);
    return j.sign(o.key || privateKey);
  };
  return { url, mint, wrongKey: other, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

export const pfApp = (pf, over = {}) => makeApp({ idp: 'pf', pfUrl: pf.url, pfIssuer: pf.url, pfJwksUrl: `${pf.url}/pf/JWKS`, pfAudience: AUD, clockSkewSec: 30, ...over });

export const bearer = (t) => ({ authorization: `Bearer ${t}` });
export const rpc = (agent, token, method, params, id = 1) =>
  agent.post('/mcp').set(bearer(token)).send({ jsonrpc: '2.0', id, method, params });

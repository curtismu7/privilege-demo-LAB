import request from 'supertest';
import * as jose from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pfApp, startStubPf, bearer } from './helpers.js';

let pf;
let ctx;
beforeAll(async () => { pf = await startStubPf(); ctx = pfApp(pf); });
afterAll(() => pf.close());

const me = (token) => request(ctx.app).get('/api/me').set(bearer(token));
const reasonOf = async (token) => { const r = await me(token); expect(r.status).toBe(401); return r.body.reason; };
const now = () => Math.floor(Date.now() / 1000);

describe('Bearer PF access token', () => {
  it('a valid token maps sub, groups, scope', async () => {
    const r = await me(await pf.mint());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sub: 'priya', groups: ['travel-agents'], scope: 'tools:invoke', source: 'bearer', isAdmin: false });
  });
  it('accepts an ES256 token too (alg allowlist is RS256/ES256)', async () => {
    // The stub JWKS only has an RSA key, so an ES256 token must fail on the key, not on the allowlist.
    const { privateKey } = await jose.generateKeyPair('ES256');
    const t = await new jose.SignJWT({ sub: 'x', groups: ['a'], client_id: 'c' }).setProtectedHeader({ alg: 'ES256', kid: 'pf-1' })
      .setIssuer(pf.url).setAudience('privilege-demo-test').setExpirationTime(now() + 60).sign(privateKey);
    expect(await reasonOf(t)).toBe('bad_signature');
  });
  it('expired', async () => expect(await reasonOf(await pf.mint({}, { exp: now() - 3600 }))).toBe('expired'));
  it('expired within the skew bound still passes, beyond it fails', async () => {
    expect((await me(await pf.mint({}, { exp: now() - 10 }))).status).toBe(200); // 10 s ago, skew 30 s
    expect(await reasonOf(await pf.mint({}, { exp: now() - 90 }))).toBe('expired');
  });
  it('the skew bound is capped at 60 s whatever the setting', async () => {
    const { config } = await import('../../src/config.js');
    process.env.CLOCK_SKEW_SEC = '3600';
    try { expect(config().clockSkewSec).toBe(60); } finally { delete process.env.CLOCK_SKEW_SEC; }
  });
  it('not yet valid (nbf in the future)', async () => expect(await reasonOf(await pf.mint({}, { nbf: now() + 3600 }))).toBe('not_yet_valid'));
  it('wrong audience', async () => expect(await reasonOf(await pf.mint({}, { aud: 'someone-else' }))).toBe('wrong_audience'));
  it('wrong issuer', async () => expect(await reasonOf(await pf.mint({}, { iss: 'https://evil.example' }))).toBe('wrong_issuer'));
  it('alg none', async () => {
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const t = `${b({ alg: 'none', typ: 'JWT' })}.${b({ sub: 'priya', groups: ['admins'], client_id: 'c', iss: pf.url, aud: 'privilege-demo-test', exp: now() + 300 })}.`;
    expect(await reasonOf(t)).toBe('alg_not_allowed');
  });
  it('HS256 (key confusion attempt) is not on the allowlist', async () => {
    const t = await new jose.SignJWT({ sub: 'x', groups: ['admins'], client_id: 'c' }).setProtectedHeader({ alg: 'HS256', kid: 'pf-1' })
      .setIssuer(pf.url).setAudience('privilege-demo-test').setExpirationTime(now() + 60).sign(new TextEncoder().encode('0123456789abcdef0123456789abcdef'));
    expect(await reasonOf(t)).toBe('alg_not_allowed');
  });
  it('signed by the wrong key', async () => expect(await reasonOf(await pf.mint({}, { key: pf.wrongKey }))).toBe('bad_signature'));
  it('missing groups claim', async () => expect(await reasonOf(await pf.mint({ groups: undefined }))).toBe('groups_missing'));
  it('claims mapClaims rejects (client_id missing, string act)', async () => {
    const r1 = await me(await pf.mint({ client_id: undefined }));
    expect(r1.body.reason).toBe('claims_invalid');
    expect(await reasonOf(await pf.mint({ act: 'dot' }))).toBe('claims_invalid');
  });
  it('an object act is carried through', async () => {
    const r = await me(await pf.mint({ act: { sub: 'dot' } }));
    expect(r.status).toBe(200);
  });
  it('no bearer, garbage, and a non-JWT', async () => {
    expect((await request(ctx.app).get('/api/me')).status).toBe(401);
    expect(await reasonOf('not-a-jwt')).toBe('malformed');
    expect((await request(ctx.app).get('/api/me').set('authorization', 'Basic abc')).body.reason).toBe('no_bearer');
  });
  it('the admins group makes an admin', async () => {
    expect((await me(await pf.mint({ sub: 'dana', groups: ['admins'] }))).body.isAdmin).toBe(true);
  });
  it('the mock cookie is not an identity when IDP=pf', async () => {
    expect((await request(ctx.app).get('/api/me').set('cookie', 'pd_session=abc.def')).status).toBe(401);
  });
});

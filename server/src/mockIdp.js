// The in-process mock "PingFederate" for mock mode. It signs access tokens for the demo personas with a key pair made at start and
// verifies them with the matching public key. Nothing is served and nothing is fetched: no socket is ever opened.
// Every token it makes is labelled mock (the `mock` claim and header, and an issuer on a .invalid host). It is NOT an identity provider.
// The key is P-256, built with createECDH + createPrivateKey (never crypto.generateKeyPair(Sync) for EC: it aborted Node on CI).
import { createECDH, createHash, createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import * as jose from 'jose';

export const MOCK_ISSUER = 'https://pf.mock.invalid';
export const MOCK_AUDIENCE = 'privilege-demo-mock';

export function createMockIdp({ now = () => Date.now(), personas, agent = null, ttlSec = 600 } = {}) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const pub = ecdh.getPublicKey(); // 0x04 || x || y
  const jwk = { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33, 65).toString('base64url'), d: ecdh.getPrivateKey().toString('base64url') };
  const privateKey = createPrivateKey({ key: jwk, format: 'jwk' });
  const publicKey = createPublicKey(privateKey);
  const kid = createHash('sha256').update(`${jwk.x}.${jwk.y}`).digest('base64url').slice(0, 16);

  const sign = (claims) => {
    const t = Math.floor(now() / 1000);
    return new jose.SignJWT({ ...claims, mock: true }).setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid, mock: true })
      .setIssuer(MOCK_ISSUER).setAudience(MOCK_AUDIENCE).setIssuedAt(t).setExpirationTime(t + ttlSec).setJti(randomUUID()).sign(privateKey);
  };

  // persona: a key of the pack's people. act: the agent's sub (the call is then unattended). agent: the agent itself is the subject.
  async function mint({ persona, act, groups, scope, agent: agentSub } = {}) {
    if (agentSub !== undefined) {
      if (!agent?.groups?.length || agentSub !== agent.sub) throw new Error('unknown agent');
      return sign({ sub: agent.sub, groups: groups || agent.groups, scope: scope || 'tools:invoke', client_id: 'privilege-demo-agent' });
    }
    const p = typeof persona === 'string' && Object.hasOwn(personas, persona) ? personas[persona] : null;
    if (!p) throw new Error('unknown persona');
    if (act !== undefined && act !== agent?.sub) throw new Error('unknown agent');
    return sign({ ...p.claims, ...(groups ? { groups } : {}), ...(scope ? { scope } : {}), ...(act ? { act: { sub: act } } : {}) });
  }

  return { mint, publicKey, issuer: MOCK_ISSUER, audience: MOCK_AUDIENCE, kid };
}

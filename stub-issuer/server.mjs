// LOCAL DEMONSTRATION ONLY. A stand-in for PingFederate: it generates an RSA key pair at start, serves the public key as a
// JWKS, and mints test access tokens for the demo personas. It is NOT an identity provider; anything it signs is for this
// app's PF mode on your own machine. The private key lives in memory only and is never written or printed.
// Minting is allowed only from the same machine (loopback peer): use `node stub-issuer/mint.mjs <persona>`.
import http from 'node:http';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as jose from 'jose';
import { PERSONAS as GENERIC_PERSONAS } from '../server/src/auth/personas.js';
import { getPack } from '../server/src/packs/index.js';

const loopbackPeer = (a) => typeof a === 'string' && (a === '::1' || a.startsWith('127.') || a.startsWith('::ffff:127.'));

// personas: the chosen vertical pack's people (default: the original four). The CLI picks them from PACK=<id>.
export function createStubIssuer({ issuer, audience, ttlSec = 600, personas: PERSONAS = GENERIC_PERSONAS, agent: AGENT = null }) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const { kty, n, e } = publicKey.export({ format: 'jwk' });
  // kid = key thumbprint, so a restarted stub (new key) is picked up by the app's cached JWKS without waiting for it to expire.
  const kid = createHash('sha256').update(`${e}.${n}`).digest('base64url').slice(0, 16);
  const jwks = { keys: [{ kty, n, e, kid, alg: 'RS256', use: 'sig' }] };

  // Claims for a persona, with optional overrides (groups, scope, act). Same shape as a verified PF access token.
  // Agent-subject token: the agent IS the subject (sub = the agent, no act claim), for an unattended lane where no person is signed in.
  // Only the pack's own agent identity can be minted, and it carries the pack's invented agent groups unless `groups` overrides them.
  function mintAgent({ agent, groups, scope }) {
    if (!AGENT || !Array.isArray(AGENT.groups) || !AGENT.groups.length) throw new Error('this pack defines no agent-subject identity');
    if (agent !== AGENT.sub) throw new Error(`unknown agent (${AGENT.sub})`);
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub: AGENT.sub, groups: groups || AGENT.groups, scope: scope || 'tools:invoke', client_id: 'privilege-demo-agent' };
    return new jose.SignJWT(claims).setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid })
      .setIssuer(issuer).setAudience(audience).setIssuedAt(now).setExpirationTime(now + ttlSec).setJti(randomUUID()).sign(privateKey);
  }

  function mint({ persona, groups, scope, act, agent }) {
    if (agent !== undefined) {
      if (persona !== undefined || act !== undefined) throw new Error('agent cannot be combined with persona or act');
      return mintAgent({ agent, groups, scope });
    }
    const p = Object.hasOwn(PERSONAS, persona) ? PERSONAS[persona] : null;
    if (!p) throw new Error(`unknown persona (${Object.keys(PERSONAS).join(', ')})`);
    const now = Math.floor(Date.now() / 1000);
    const claims = { ...p.claims, ...(groups ? { groups } : {}), ...(scope ? { scope } : {}), ...(act ? { act: { sub: act } } : {}) };
    return new jose.SignJWT(claims).setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid })
      .setIssuer(issuer).setAudience(audience).setIssuedAt(now).setExpirationTime(now + ttlSec).setJti(randomUUID()).sign(privateKey);
  }

  const server = http.createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const path = req.url.split('?')[0];
    if (req.method === 'GET' && path === '/pf/JWKS') return json(200, jwks);
    if (req.method === 'GET' && path === '/.well-known/openid-configuration') return json(200, { issuer, jwks_uri: `${issuer}/pf/JWKS`, note: 'local demonstration stub, not PingFederate' });
    if (req.method === 'POST' && path === '/mint') {
      if (!loopbackPeer(req.socket.remoteAddress)) return json(403, { error: 'mint_is_local_only' });
      let raw = '';
      for await (const c of req) { raw += c; if (raw.length > 4096) return json(413, { error: 'too_large' }); }
      try {
        const b = JSON.parse(raw || '{}');
        return json(200, { access_token: await mint(b) });
      } catch (err) { return json(400, { error: String(err.message).slice(0, 100) }); }
    }
    return json(404, { error: 'not_found' });
  });
  return { server, mint, jwks };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.STUB_PORT) || 9031;
  const host = process.env.STUB_HOST || '127.0.0.1';
  const issuer = process.env.STUB_ISSUER || `http://127.0.0.1:${port}`;
  const audience = process.env.STUB_AUDIENCE || 'privilege-demo';
  const pack = getPack(process.env.PACK);
  if (!pack) { console.error('[stub-issuer] unknown PACK'); process.exit(1); }
  const { server } = createStubIssuer({ issuer, audience, personas: pack.personas, agent: pack.agent });
  server.listen(port, host, () => console.log(`[stub-issuer] LOCAL DEMO ONLY, not PingFederate. ${issuer}/pf/JWKS  audience=${audience}  (new key pair generated)`));
}

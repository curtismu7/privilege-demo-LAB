// LIVE path: verify "Authorization: Bearer <PingFederate access token>" against the PF JWKS and map the claims.
// Reasons are fixed codes: nothing from the token or the library's message is echoed back.
import * as jose from 'jose';
import { mapClaims } from '../cedar/index.js';

const ALGS = ['RS256', 'ES256']; // never "none", never HS*

function reasonOf(err) {
  switch (err?.code) {
    case 'ERR_JWT_EXPIRED': return 'expired';
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      return { iss: 'wrong_issuer', aud: 'wrong_audience', nbf: 'not_yet_valid', exp: 'expired' }[err.claim] || 'claim_invalid';
    case 'ERR_JOSE_ALG_NOT_ALLOWED': return 'alg_not_allowed';
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
    case 'ERR_JWKS_NO_MATCHING_KEY':
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS': return 'bad_signature';
    case 'ERR_JWT_INVALID': case 'ERR_JWS_INVALID': return 'malformed';
    default: return 'unverifiable';
  }
}

export function createPfVerifier(cfg) {
  const jwks = cfg.pfJwksUrl ? jose.createRemoteJWKSet(new URL(cfg.pfJwksUrl), { cooldownDuration: 10000, timeoutDuration: 3000 }) : null;
  // Returns { ok:true, claims } or { ok:false, reason, problems? }
  return async function verify(authorization) {
    const raw = /^Bearer ([A-Za-z0-9._~+/=-]+)$/i.exec(authorization || '')?.[1];
    if (!raw) return { ok: false, reason: 'no_bearer' };
    if (!jwks) return { ok: false, reason: 'pf_not_configured' };
    let payload;
    try {
      ({ payload } = await jose.jwtVerify(raw, jwks, {
        issuer: cfg.pfIssuer, audience: cfg.pfAudience, algorithms: ALGS,
        clockTolerance: cfg.clockSkewSec, requiredClaims: ['exp', 'sub'],
      }));
    } catch (e) { return { ok: false, reason: reasonOf(e) }; }
    if (!Array.isArray(payload.groups)) return { ok: false, reason: 'groups_missing' };
    const picked = {};
    for (const k of ['sub', 'groups', 'scope', 'client_id', 'act']) if (payload[k] !== undefined) picked[k] = payload[k];
    const mapped = mapClaims(picked);
    if (!mapped.ok) return { ok: false, reason: 'claims_invalid', problems: mapped.problems };
    return { ok: true, claims: picked };
  };
}

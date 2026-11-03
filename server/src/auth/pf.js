// Bearer verification: "Authorization: Bearer <access token>" is verified against a JWKS and the claims are mapped.
// LIVE path: the PingFederate JWKS (fetched through the netguard, so only the configured origin can be reached).
// MOCK path: the in-process mock issuer's public key (mockIdp.js); no network at all.
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

// keySource: a jose key or key-resolving function (a remote JWKS, or the mock issuer's public key).
export function createVerifier({ keySource, issuer, audience, clockSkewSec }) {
  // Returns { ok:true, claims } or { ok:false, reason, problems? }
  return async function verify(authorization) {
    const raw = /^Bearer ([A-Za-z0-9._~+/=-]+)$/i.exec(authorization || '')?.[1];
    if (!raw) return { ok: false, reason: 'no_bearer' };
    if (!keySource) return { ok: false, reason: 'pf_not_configured' };
    let payload;
    try {
      ({ payload } = await jose.jwtVerify(raw, keySource, {
        issuer, audience, algorithms: ALGS, clockTolerance: clockSkewSec, requiredClaims: ['exp', 'sub'],
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

// The live verifier. fetchImpl is the netguard's fetch: in mock mode it refuses everything, in live mode it reaches only PF_URL's origin.
export function createPfVerifier(cfg, { fetchImpl } = {}) {
  const keySource = cfg.pfJwksUrl
    ? jose.createRemoteJWKSet(new URL(cfg.pfJwksUrl), { cooldownDuration: 10000, timeoutDuration: 3000, ...(fetchImpl ? { [jose.customFetch]: fetchImpl } : {}) })
    : null;
  const verifyJwt = createVerifier({ keySource, issuer: cfg.pfIssuer, audience: cfg.pfAudience, clockSkewSec: cfg.clockSkewSec });
  // PingFederate issues REFERENCE (opaque) tokens when the grant's access token manager is the reference plugin.
  // Those cannot be verified against the JWKS; RFC 7662 introspection at the same PingFederate is the standard
  // answer, authenticated with the sign-in client. Same contract as the JWT verifier: { ok, claims } or { ok:false, reason }.
  const verifyReference = async (raw) => {
    if (!cfg.pfIntrospectionUrl || !cfg.pfAuthClientId || !cfg.pfAuthClientSecret) return { ok: false, reason: 'pf_not_configured' };
    let response;
    try {
      response = await fetchImpl(cfg.pfIntrospectionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${cfg.pfAuthClientId}:${cfg.pfAuthClientSecret}`).toString('base64')}` },
        body: new URLSearchParams({ token: raw, token_type_hint: 'access_token' }).toString(),
        signal: AbortSignal.timeout(8000),
      });
    } catch { return { ok: false, reason: 'pf_unreachable' }; }
    if (!response.ok) return { ok: false, reason: 'pf_introspection_failed' };
    let payload;
    try { payload = await response.json(); } catch { return { ok: false, reason: 'pf_introspection_failed' }; }
    if (!payload || payload.active !== true) return { ok: false, reason: 'token_inactive' };
    const picked = {};
    for (const k of ['sub', 'groups', 'scope', 'client_id', 'act', 'username']) if (payload[k] !== undefined) picked[k] = payload[k];
    if (!Array.isArray(picked.groups)) return { ok: false, reason: 'groups_missing' };
    const mapped = mapClaims(picked);
    if (!mapped.ok) return { ok: false, reason: 'claims_invalid', problems: mapped.problems };
    return { ok: true, claims: picked };
  };
  return async function verify(authorization) {
    const raw = /^Bearer ([A-Za-z0-9._~+/=-]+)$/i.exec(authorization || '')?.[1];
    if (!raw) return { ok: false, reason: 'no_bearer' };
    if (raw.split('.').length === 3) return verifyJwt(authorization);
    return verifyReference(raw);
  };
}

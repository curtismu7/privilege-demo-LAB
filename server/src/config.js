// Environment settings, read at call time so tests can change process.env. No secrets are logged.
// Single-tenant by design: one policy store, one approval queue, one trace buffer per process (no workspace ids).
import path from 'node:path';
import { PACKS } from './packs/index.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function config() {
  const env = process.env;
  const idp = env.IDP || 'local-mock'; // local-mock | pf
  const dataDir = env.DATA_DIR || '.data';
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    port: Number(env.PORT) || 8080,
    // Loopback by default in every mode. A container sets HOST=0.0.0.0 itself (Dockerfile) and compose publishes on 127.0.0.1 only.
    host: env.HOST || '127.0.0.1',
    appOrigin: env.APP_ORIGIN || `http://localhost:${Number(env.PORT) || 8080}`,
    nodeEnv: env.NODE_ENV || '',
    dataDir,
    idp,
    // Vertical pack: personas, tools, Cedar schema and shipped policies. generic = the original demo, unchanged.
    pack: env.PACK || 'generic',
    // Mock sign-in needs BOTH switches. The literal "1" only; "true" does not count.
    mockSignin: idp === 'local-mock' && env.ALLOW_MOCK_SIGNIN === '1',
    adminSwitchFile: env.ADMIN_SWITCH_FILE || path.join(dataDir, 'ALLOW_ADMIN_PERSONA'),
    sessionSecret: env.SESSION_SECRET || '',
    sessionTtlMs: num(env.SESSION_TTL_MS, 8 * 3600 * 1000),
    approvalTtlMs: num(env.APPROVAL_TTL_MS, 10 * 60 * 1000),
    pfUrl: (env.PF_URL || '').replace(/\/+$/, ''),
    pfIssuer: (env.PF_ISSUER || env.PF_URL || '').replace(/\/+$/, ''),
    pfJwksUrl: env.PF_JWKS_URL || (env.PF_URL ? `${env.PF_URL.replace(/\/+$/, '')}/pf/JWKS` : ''),
    pfAudience: env.PF_AUDIENCE || '',
    // Host names (comma separated) that may be reached over plain http, beside loopback. For the compose stub issuer only.
    pfHttpHosts: (env.PF_HTTP_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    clockSkewSec: Math.min(num(env.CLOCK_SKEW_SEC, 30), 60), // hard upper bound: 60 s
  };
}

export const isLoopbackHost = (h) => LOOPBACK_HOSTS.has(String(h).toLowerCase());

// Everything that must stop the process at startup. index.js prints these and exits 1.
export function startupProblems(c = config()) {
  const p = [];
  const prod = c.nodeEnv === 'production';
  if (prod && (c.idp === 'local-mock' || process.env.ALLOW_MOCK_SIGNIN === '1')) {
    p.push('mock sign-in is not allowed when NODE_ENV=production (set IDP=pf and ALLOW_MOCK_SIGNIN=0)');
  }
  if (c.mockSignin && !isLoopbackHost(c.host)) p.push('mock sign-in needs a loopback listener (HOST=127.0.0.1)');
  if (!['local-mock', 'pf'].includes(c.idp)) p.push('IDP must be local-mock or pf');
  if (c.pack !== undefined && !Object.hasOwn(PACKS, c.pack)) p.push(`PACK must be one of ${Object.keys(PACKS).join(', ')}`);
  if (c.idp === 'pf') {
    if (!c.pfUrl) p.push('IDP=pf needs PF_URL');
    if (!c.pfAudience) p.push('IDP=pf needs PF_AUDIENCE');
    for (const u of [c.pfIssuer, c.pfJwksUrl]) {
      if (!u) continue;
      let parsed;
      try { parsed = new URL(u); } catch { p.push('PF_URL / PF_JWKS_URL must be absolute URLs'); continue; }
      const plainOk = parsed.protocol === 'http:' && (isLoopbackHost(parsed.hostname) || (c.pfHttpHosts ?? []).includes(parsed.hostname.toLowerCase()));
      if (parsed.protocol !== 'https:' && !plainOk) {
        p.push('PF_URL and the JWKS URL must be https (http only for loopback)');
      }
    }
  }
  return [...new Set(p)];
}

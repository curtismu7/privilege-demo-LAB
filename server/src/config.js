// Environment settings, read at call time so tests can change process.env. No secrets are logged.
// One policy store, one approval queue and one trace buffer per workspace (see workspaces.js); the workspace id defaults to "default".
import path from 'node:path';
import { PACKS } from './packs/index.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
export const DEFAULT_PORT = 4510;
export const MODES = ['mock', 'live'];
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export function config() {
  const env = process.env;
  // DEMO_MODE (or MODE, when it says mock or live: Vitest and other tools set MODE to unrelated words, which are ignored).
  // Rule 19: Real is the default when configured — PF_URL + PF_AUDIENCE present and DEMO_MODE unset means live.
  const pfConfigured = Boolean(env.PF_URL && env.PF_AUDIENCE);
  const modeRaw = env.DEMO_MODE || (['mock', 'live'].includes(env.MODE) ? env.MODE : pfConfigured ? 'live' : 'mock');
  const mode = modeRaw === 'live' ? 'live' : 'mock';
  const dataDir = env.DATA_DIR || '.data';
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const port = Number(env.PORT) || DEFAULT_PORT;
  return {
    port,
    // Loopback by default. A container sets HOST=0.0.0.0 itself (Dockerfile) and compose publishes on 127.0.0.1 only (LAB_PUBLISH=loopback).
    host: env.HOST || '127.0.0.1',
    publish: env.LAB_PUBLISH === 'loopback' ? 'loopback' : '',
    // Extra host names (comma separated) the app answers to besides 127.0.0.1, localhost and [::1].
    allowedHosts: String(env.LAB_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    appOrigin: env.APP_ORIGIN || `http://localhost:${port}`,
    nodeEnv: env.NODE_ENV || '',
    dataDir,
    // DEMO_MODE: mock (default, everything in process) or live (Bearer tokens from the PingFederate named by PF_URL). The page toggles it at run time.
    modeRaw,
    mode,
    // Kept for the code that already reads it: local-mock = mock mode, pf = live mode.
    idp: mode === 'live' ? 'pf' : 'local-mock',
    // Vertical pack: personas, tools, Cedar schema and shipped policies. generic = the original demo, unchanged.
    pack: env.PACK || 'generic',
    // Mock sign-in is allowed only by the literal "1" (rule 11). It still needs a loopback bind, no proxy and mock mode, per request.
    mockSignin: env.ALLOW_MOCK_SIGNIN === '1',
    adminSwitchFile: env.ADMIN_SWITCH_FILE || path.join(dataDir, 'ALLOW_ADMIN_PERSONA'),
    sessionSecret: env.SESSION_SECRET || '',
    sessionTtlMs: num(env.SESSION_TTL_MS, 8 * 3600 * 1000),
    approvalTtlMs: num(env.APPROVAL_TTL_MS, 10 * 60 * 1000),
    pfUrl: (env.PF_URL || '').replace(/\/+$/, ''),
    pfIssuer: (env.PF_ISSUER || env.PF_URL || '').replace(/\/+$/, ''),
    pfJwksUrl: env.PF_JWKS_URL || (env.PF_URL ? `${env.PF_URL.replace(/\/+$/, '')}/pf/JWKS` : ''),
    pfAudience: env.PF_AUDIENCE || '',
    // Live sign-in (pi.flow): the OAuth client the lab drives through PingFederate's Authentication API.
    pfAuthClientId: env.PF_AUTH_CLIENT_ID || '',
    pfAuthClientSecret: env.PF_AUTH_CLIENT_SECRET || '',
    pfAuthRedirectUri: env.PF_AUTH_REDIRECT_URI || (env.PF_URL ? `${env.PF_URL.replace(/\/+$/, '')}/cb` : ''),
    pfAuthScope: env.PF_AUTH_SCOPE || 'openid profile',
    // Host names (comma separated) that may be reached over plain http, beside loopback. For the compose stub issuer only.
    pfHttpHosts: (env.PF_HTTP_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    clockSkewSec: Math.min(num(env.CLOCK_SKEW_SEC, 30), 60), // hard upper bound: 60 s
  };
}

import { loginProblems } from './auth/piflowLogin.js';
export { loginProblems };

export const isLoopbackHost = (h) => LOOPBACK_HOSTS.has(String(h).toLowerCase());

// What live mode still needs (empty = live mode can be used). Used by the startup check and by the Mock/Live toggle.
export function liveProblems(c = config()) {
  const p = [];
  if (!c.pfUrl) p.push('live mode needs PF_URL');
  if (!c.pfAudience) p.push('live mode needs PF_AUDIENCE');
  p.push(...loginProblems(c));
  for (const u of [c.pfIssuer, c.pfJwksUrl]) {
    if (!u) continue;
    let parsed;
    try { parsed = new URL(u); } catch { p.push('PF_URL / PF_JWKS_URL must be absolute URLs'); continue; }
    const plainOk = parsed.protocol === 'http:' && (isLoopbackHost(parsed.hostname) || (c.pfHttpHosts ?? []).includes(parsed.hostname.toLowerCase()));
    if (parsed.protocol !== 'https:' && !plainOk) p.push('PF_URL and the JWKS URL must be https (http only for loopback)');
  }
  return [...new Set(p)];
}

// Everything that must stop the process at startup. index.js prints these and exits 1.
export function startupProblems(c = config()) {
  const p = [];
  // NODE_ENV is not a guard (the Docker image sets it). A non-loopback bind is allowed only when compose says the port is published on 127.0.0.1 only.
  if (c.mockSignin && !isLoopbackHost(c.host) && c.publish !== 'loopback') p.push('mock sign-in needs a loopback listener (HOST=127.0.0.1)');
  if (c.modeRaw !== undefined && !MODES.includes(c.modeRaw)) p.push('DEMO_MODE must be mock or live');
  for (const h of c.allowedHosts ?? []) if (!HOSTNAME.test(h)) p.push('LAB_ALLOWED_HOSTS must be host names');
  if (c.pack !== undefined && !Object.hasOwn(PACKS, c.pack)) p.push(`PACK must be one of ${Object.keys(PACKS).join(', ')}`);
  if (c.idp === 'pf') p.push(...liveProblems(c));
  return [...new Set(p)];
}

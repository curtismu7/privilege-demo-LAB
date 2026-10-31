// Preflight: what this running server needs and the fix for each thing that is missing. Used by GET /api/preflight (and so by the
// Sign in page). Reports names and states only: never a token, a secret or a configured URL.
import fs from 'node:fs';
import { adminSwitchPresent } from './auth/guards.js';
import { startupProblems } from './config.js';

const JWKS_TTL_MS = 10000;

export function createPreflight({ cfg, store, now = () => Date.now(), fetchImpl = fetch }) {
  let jwksCache = null; // { at, ok }

  async function jwksReachable() {
    if (jwksCache && now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.ok;
    let ok = false;
    try {
      const res = await fetchImpl(cfg.pfJwksUrl, { signal: AbortSignal.timeout(2000) });
      const body = res.ok ? await res.json() : null;
      ok = Array.isArray(body?.keys) && body.keys.length > 0;
    } catch { ok = false; }
    jwksCache = { at: now(), ok };
    return ok;
  }

  return async function run() {
    const checks = [];
    const add = (id, ok, message, fix, level = 'error') => checks.push({ id, ok, level, message, ...(ok ? {} : { fix }) });

    for (const p of startupProblems(cfg)) add('config', false, p, 'Fix the setting in .env (see .env.example), then restart the server.');

    if (cfg.idp === 'pf') {
      add('pf-url', Boolean(cfg.pfUrl), 'PF_URL is set', 'Set PF_URL to your PingFederate base URL in .env (docker compose: see README, "Point it at a real PingFederate").');
      add('pf-audience', Boolean(cfg.pfAudience), 'PF_AUDIENCE is set', 'Set PF_AUDIENCE to the audience your PingFederate puts in access tokens for this app.');
      if (cfg.pfJwksUrl) {
        add('pf-jwks', await jwksReachable(), 'The PingFederate JWKS is reachable and has keys',
          'Check PF_URL (or PF_JWKS_URL) from this server: it must serve a JWKS document. With the local stub, start it (docker compose up, or node stub-issuer/server.mjs).');
      }
    } else if (cfg.idp === 'local-mock') {
      add('mock-signin', cfg.mockSignin, 'Offline mock sign-in is on', 'Set ALLOW_MOCK_SIGNIN=1 in .env (host-run only, loopback only), then restart.');
      add('admin-switch', adminSwitchPresent(cfg), 'Dana (admin) is available', 'Create the empty file DATA_DIR/ALLOW_ADMIN_PERSONA (touch .data/ALLOW_ADMIN_PERSONA), then reload. Without it Dana is hidden.', 'warn');
    }

    let writable = true;
    try { fs.accessSync(cfg.dataDir, fs.constants.W_OK); } catch { writable = false; }
    add('data-dir', writable, 'DATA_DIR is writable', 'Make DATA_DIR exist and be writable by the server user (docker: the privilege-demo-data volume).');
    add('policies', !store.activeError(), 'The active policies compile', 'Fix or delete the broken file under DATA_DIR/policies/active, or sign in as an admin and use Reset.');

    return { ok: checks.every((c) => c.ok || c.level !== 'error'), idp: cfg.idp, checks };
  };
}

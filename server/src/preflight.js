// Preflight: what this running server needs and the fix for each thing that is missing. Used by GET /api/preflight (and so by the
// Sign in page). Reports names and states only: never a token, a secret or a configured URL.
// The JWKS check is the one network call, and it goes through the netguard: it runs only in live mode, only to the configured PingFederate.
import fs from 'node:fs';
import { adminSwitchPresent } from './auth/guards.js';
import { startupProblems } from './config.js';

const JWKS_TTL_MS = 10000;

export function createPreflight({ cfg, mode, now = () => Date.now(), fetchImpl }) {
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

  return async function run(store) {
    const checks = [];
    const add = (id, ok, message, fix, level = 'error') => checks.push({ id, ok, level, message, ...(ok ? {} : { fix }) });
    const live = mode() === 'live';

    // Live problems are reported only in live mode: mock mode needs no PingFederate settings.
    for (const p of startupProblems({ ...cfg, idp: live ? 'pf' : 'local-mock' })) {
      add('config', false, p, 'Fix the setting in ~/Development/.env (see .env.example), then restart the server.');
    }

    if (live) {
      add('pf-url', Boolean(cfg.pfUrl), 'PF_URL is set', 'Set PF_URL to your PingFederate base URL in ~/Development/.env (docker compose: see README, "Point it at a real PingFederate").');
      add('pf-audience', Boolean(cfg.pfAudience), 'PF_AUDIENCE is set', 'Set PF_AUDIENCE to the audience your PingFederate puts in access tokens for this app.');
      if (cfg.pfJwksUrl) {
        add('pf-jwks', await jwksReachable(), 'The PingFederate JWKS is reachable and has keys',
          'Check PF_URL (or PF_JWKS_URL) from this server: it must serve a JWKS document. With the local stub, start it (docker compose --profile stub up, or node stub-issuer/server.mjs).');
      }
    } else {
      add('mock-signin', cfg.mockSignin, 'Offline mock sign-in is on', 'Set ALLOW_MOCK_SIGNIN=1 (npm start sets it for you on a loopback bind), then restart.');
      add('admin-switch', adminSwitchPresent(cfg), 'Dana (admin) is available', 'Create the empty file DATA_DIR/ALLOW_ADMIN_PERSONA (touch .data/ALLOW_ADMIN_PERSONA), then reload. Without it Dana is hidden.', 'warn');
    }

    let writable = true;
    try { fs.accessSync(cfg.dataDir, fs.constants.W_OK); } catch { writable = false; }
    add('data-dir', writable, 'DATA_DIR is writable', 'Make DATA_DIR exist and be writable by the server user (docker: the privilege-demo-data volume).');
    add('policies', !store.activeError(), 'The active policies compile', 'Fix or delete the broken file under DATA_DIR/policies/active, or sign in as an admin and use Reset.');

    return { ok: checks.every((c) => c.ok || c.level !== 'error'), idp: live ? 'pf' : 'local-mock', mode: mode(), checks };
  };
}

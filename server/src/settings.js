// The shared settings loader. Every standalone app reads one settings file: ~/Development/.env (mode 600), or the file named by
// STANDALONE_ENV. Real environment variables always win over the file.
//
// Only the keys in ALLOWED are ever kept. Every other line is dropped as it is read, so admin and worker credentials (which belong
// only in ~/.config/demo-kit/provisioning.json) are never stored, used or returned, even if someone put them in the file. The file
// is parsed with no value ever logged: results name keys, never values.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// PRIVILEGE_DEMO_MODE is this app's name for DEMO_MODE in the shared file (other apps read the same file, so a bare MODE would be shared).
export const ALLOWED = new Set([
  'PRIVILEGE_DEMO_MODE', 'DEMO_MODE', 'PACK', 'DATA_DIR', 'APPROVAL_TTL_MS', 'SESSION_SECRET', 'SESSION_TTL_MS', 'CLOCK_SKEW_SEC',
  'PF_URL', 'PF_AUDIENCE', 'PF_ISSUER', 'PF_JWKS_URL', 'PF_HTTP_HOSTS',
]);
// Names that must never be in the shared file. Seen in the file, they are reported (by name) and ignored.
export const FORBIDDEN = /(^|_)(ADMIN|WORKER|VAULT)(_|$)|CLIENT_SECRET|PASSWORD|PRIVATE_KEY|TOKEN/;

export const sharedEnvPath = (env = process.env) => env.STANDALONE_ENV || path.join(os.homedir(), 'Development', '.env');

function parseLine(line) {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (!m) return null;
  let value = m[2];
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) value = value.slice(1, -1);
  else value = value.replace(/\s+#.*$/, '');
  return [m[1], value];
}

/**
 * Reads the shared file into `env` (only ALLOWED keys that `env` does not already have).
 * Returns { file, found, loaded: [key names], refused: [key names], modeOk }. Never throws, never returns a value.
 */
export function loadSharedEnv({ env = process.env, file = sharedEnvPath(env) } = {}) {
  const result = { file, found: false, loaded: [], refused: [], modeOk: true };
  let text;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return result;
    result.found = true;
    result.modeOk = (stat.mode & 0o077) === 0;
    text = fs.readFileSync(file, 'utf8');
  } catch { return result; }
  for (const line of text.split(/\r?\n/)) {
    const kv = parseLine(line);
    if (!kv) continue;
    const [key, value] = kv;
    if (FORBIDDEN.test(key)) { result.refused.push(key); continue; }
    if (!ALLOWED.has(key)) continue; // another app's key: dropped unread
    const name = key === 'PRIVILEGE_DEMO_MODE' ? 'DEMO_MODE' : key;
    if (env[name] !== undefined) continue;
    env[name] = value;
    result.loaded.push(name);
  }
  return result;
}

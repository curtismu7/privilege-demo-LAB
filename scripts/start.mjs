import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The repo's own .env (gitignored) carries the owner's live PingFederate config so `npm start` works without
// exporting variables by hand. Real environment variables keep priority: they are set before this runs.
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch { /* no .env: defaults apply */ }

process.env.ALLOW_MOCK_SIGNIN ??= '1';
await import('../server/src/index.js');

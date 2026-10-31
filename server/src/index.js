import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { config, startupProblems } from './config.js';

// Local runs read the repo-root .env (real env vars win). Containers get env from compose.
try { process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url))); } catch { /* no .env */ }

const cfg = config();
const problems = startupProblems(cfg);
if (problems.length) {
  for (const p of problems) console.error(`[privilege-demo] refusing to start: ${p}`);
  process.exit(1);
}
createApp({ cfg }).listen(cfg.port, cfg.host, () =>
  console.log(`[privilege-demo] listening on http://${cfg.host}:${cfg.port} (idp=${cfg.idp}${cfg.mockSignin ? ', mock sign-in on' : ''})`));

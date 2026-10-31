import { createApp } from './app.js';
import { config, startupProblems } from './config.js';
import { loadSharedEnv } from './settings.js';

// Settings: real environment variables win; then the one shared file (~/Development/.env, or the file STANDALONE_ENV names).
// Only this app's own keys are read from it (settings.js); admin and worker credentials are never read.
const shared = loadSharedEnv();
if (shared.found && !shared.modeOk) console.warn(`[privilege-demo] ${shared.file} is readable by others; run chmod 600 on it`);
for (const key of shared.refused) console.warn(`[privilege-demo] ${key} must not be in the shared settings file; it was ignored`);

const cfg = config();
const problems = startupProblems(cfg);
if (problems.length) {
  for (const p of problems) console.error(`[privilege-demo] refusing to start: ${p}`);
  process.exit(1);
}
const app = createApp({ cfg });
for (const warning of app.locals.customerWarnings || []) console.warn(`[privilege-demo] customer.config: ${warning}`);

// The netguard's self-test: a real URL must be refused before the app answers anything (nothing leaves the machine in mock mode).
const guard = await app.locals.netguard.selfTest();
if (!guard.ok) {
  console.error('[privilege-demo] netguard self-test failed; refusing to start');
  process.exit(1);
}
app.listen(cfg.port, cfg.host, () =>
  console.log(`[privilege-demo] listening on http://${cfg.host}:${cfg.port} (mode=${cfg.mode}${process.env.DEMO_MODE ? ' from DEMO_MODE' : ''}${cfg.mockSignin ? ', mock sign-in allowed' : ''})`));

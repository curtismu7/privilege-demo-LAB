// Preflight: Node version, .env, DATA_DIR writable, port free, Cedar loads and the shipped policies validate.
// Prints only pass/fail lines, never values of secrets. Exit 1 on any failure. Needs no network in IDP=local-mock; with IDP=pf
// it also fetches the PingFederate JWKS (the one network call). Each FAIL names the fix.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch { /* optional */ }

let failed = 0;
const report = (ok, name, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
};

const { config, startupProblems } = await import(pathToFileURL(path.join(root, 'server/src/config.js')));
const major = Number(process.versions.node.split('.')[0]);
report(major >= 20, 'Node version', `v${process.versions.node} (need >= 20)`);

console.log(`INFO  .env ${fs.existsSync(path.join(root, '.env')) ? 'present' : 'absent (fine for mock mode; copy .env.example for pf)'}`);

const dataDir = path.resolve(root, process.env.DATA_DIR || '.data');
try {
  fs.mkdirSync(dataDir, { recursive: true });
  const probe = path.join(dataDir, `.doctor-${process.pid}`);
  fs.writeFileSync(probe, 'x');
  fs.rmSync(probe);
  report(true, 'DATA_DIR writable', path.relative(root, dataDir) || '.');
} catch (e) { report(false, 'DATA_DIR writable', e.code || 'error'); }

const port = Number(process.env.PORT) || 8080;
await new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', (e) => { report(false, 'port free', `${port} (${e.code}). Set PORT in .env to a free port`); resolve(); });
  s.listen(port, () => s.close(() => { report(true, 'port free', String(port)); resolve(); }));
});

const cfg = config();
report(['local-mock', 'pf'].includes(cfg.idp), 'IDP', cfg.idp);
for (const p of startupProblems(cfg)) report(false, 'configuration', `${p}. Fix it in .env (see .env.example)`);
if (cfg.idp === 'pf' && cfg.pfJwksUrl && !startupProblems(cfg).length) {
  try {
    const res = await fetch(cfg.pfJwksUrl, { signal: AbortSignal.timeout(3000) });
    const body = res.ok ? await res.json() : null;
    report(Array.isArray(body?.keys) && body.keys.length > 0, 'PingFederate JWKS reachable', res.ok ? 'has keys' : `HTTP ${res.status}. Check PF_URL / PF_JWKS_URL`);
  } catch { report(false, 'PingFederate JWKS reachable', 'no answer. Check PF_URL / PF_JWKS_URL, or start the stub: node stub-issuer/server.mjs'); }
}

try {
  const cedar = await import(pathToFileURL(path.join(root, 'server/src/cedar/index.js')));
  cedar.init();
  report(true, 'cedar-wasm loads');
  const policies = cedar.loadShippedPolicies();
  const res = cedar.validatePolicies(policies);
  report(res.ok, 'shipped policies validate', `${Object.keys(policies).length} policies${res.ok ? '' : `, ${res.problems.length} problem(s)`}`);
} catch (e) { report(false, 'cedar-wasm and policies', e.message); }

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nAll checks passed.');

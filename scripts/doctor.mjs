// npm run doctor: one line per check, exit 1 when any fails. Works with no settings file and no PingFederate: every check runs in
// mock mode on a temporary data folder, so nothing leaves this machine. It prints pass/fail and names, never the value of a setting.
// With DEMO_MODE=live it adds one check: the configured PingFederate's JWKS, fetched through the same netguard the app uses.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => import(pathToFileURL(path.join(root, p)).href);
const checks = [];
const check = (name, fn) => checks.push({ name, fn });

const scratch = [];
const tempDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-doctor-')); scratch.push(dir); return dir; };
process.on('exit', () => { for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true }); });

const listenFree = (port) => new Promise((resolve) => {
  const probe = net.createServer();
  probe.once('error', (error) => resolve(error.code === 'EADDRINUSE' ? 'busy' : 'error'));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve('free')));
});
const getHealth = (port) => new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => {
    let text = '';
    res.on('data', (d) => { text += d; if (text.length > 8192) req.destroy(); });
    res.on('end', () => { try { resolve(JSON.parse(text)); } catch { resolve(null); } });
  });
  req.on('error', () => resolve(null));
  req.on('timeout', () => req.destroy());
});

// Settings are loaded the way the app loads them, so the doctor sees what the app will see.
const { loadSharedEnv } = await src('server/src/settings.js');
const shared = loadSharedEnv();

check('node 26 or newer', () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 26) throw new Error(`Node ${process.versions.node}; this app needs 26 or newer (engines is >=26)`);
  return `Node ${process.versions.node}`;
});

check('shared settings file readable and private', () => {
  if (!shared.found) return `no ${path.basename(shared.file)} yet (mock mode needs none)`;
  if (!shared.modeOk) throw new Error(`${shared.file} is readable by others; run chmod 600 on it`);
  if (shared.refused.length) throw new Error(`${shared.refused.join(', ')} must not be in the shared file; move it to ~/.config/demo-kit/provisioning.json`);
  return `${shared.loaded.length} setting(s) read from it (names only, no values shown)`;
});

check('configuration is valid', async () => {
  const { config, startupProblems } = await src('server/src/config.js');
  const problems = startupProblems(config());
  if (problems.length) throw new Error(problems.join('; '));
  return `mode ${config().mode}`;
});

check('cedar loads and the shipped policies validate (generic and utility packs)', async () => {
  const cedar = await src('server/src/cedar/index.js');
  const { PACKS } = await src('server/src/packs/index.js');
  cedar.init();
  let total = 0;
  for (const pack of Object.values(PACKS)) {
    const policies = pack.shippedPolicies();
    const res = cedar.validatePolicies(policies, { schema: pack.schema });
    if (!res.ok) throw new Error(`${pack.id}: ${res.problems.length} problem(s)`);
    total += Object.keys(policies).length;
  }
  return `${total} policies in ${Object.keys(PACKS).length} packs`;
});

// The app is built in process, in mock mode, on a temporary data folder, with a fetch that fails the check if it is ever called.
async function mockApp() {
  const { createApp } = await src('server/src/app.js');
  const { config } = await src('server/src/config.js');
  const dataDir = tempDir();
  let attempts = 0;
  const cfg = { ...config(), mode: 'mock', idp: 'local-mock', dataDir, adminSwitchFile: path.join(dataDir, 'ALLOW_ADMIN_PERSONA'), mockSignin: true, host: '127.0.0.1' };
  const app = createApp({ cfg, customerFile: path.join(dataDir, 'none.json'), fetchImpl: () => { attempts += 1; throw new Error('a real fetch was attempted'); } });
  return { app, attempts: () => attempts };
}

check('mock mode: netguard self-test, zero outbound attempts', async () => {
  const { app, attempts } = await mockApp();
  const result = await app.locals.netguard.selfTest();
  if (!result.ok) throw new Error(`the netguard self-test failed: ${result.checks.filter((c) => !c.ok).map((c) => c.name).join('; ')}`);
  if (attempts() !== 0 || app.locals.netguard.stats().realAttempts !== 0) throw new Error('the netguard saw a real outbound attempt');
  return `${result.checks.length} self-test checks; a real URL is refused before any socket opens`;
});

check('health route answers demo-health/1', async () => {
  const { app } = await mockApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const health = await getHealth(server.address().port);
    if (health?.schema !== 'demo-health/1' || health.demo?.id !== 'privilege-demo') throw new Error('unexpected health reply');
    if (health.runtime !== 'offline') throw new Error(`runtime is ${health.runtime}; mock mode should be offline`);
    return `state ${health.state}, runtime ${health.runtime}`;
  } finally { server.closeAllConnections(); server.close(); }
});

check('a tool call is decided by Cedar, offline', async () => {
  const { app } = await mockApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const post = (p, body, cookie) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, (res) => {
        let text = '';
        res.on('data', (d) => { text += d; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(text || '{}') }));
      });
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
    const login = await post('/api/auth/mock/login', { persona: 'mary' });
    const cookie = String(login.headers['set-cookie']?.[0] || '').split(';')[0];
    const call = await post('/api/tools/call', { tool: 'search_flights', args: { query: 'x' } }, cookie);
    if (call.body.outcome !== 'allow') throw new Error(`expected allow for search_flights, got ${call.body.outcome}`);
    const denied = await post('/api/tools/call', { tool: 'pay_invoice', args: { invoiceId: 'I-1', amount: 5 } }, cookie);
    if (denied.body.outcome !== 'deny') throw new Error(`expected deny for pay_invoice by an analyst, got ${denied.body.outcome}`);
    return 'allow for search_flights, deny for pay_invoice (analyst)';
  } finally { server.closeAllConnections(); server.close(); }
});

check('port free, or already this app', async () => {
  const port = Number(process.env.PORT || 4510);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be a number from 1024 to 65535');
  if (await listenFree(port) === 'free') return `${port} is free`;
  const health = await getHealth(port);
  if (health?.demo?.id === 'privilege-demo') return `${port} is in use by this app (${health.runtime})`;
  throw new Error(`${port} is in use by something else (see "Ports" in the README)`);
});

check('diagrams validate (diagram-studio/1)', async () => {
  const { validateDiagram } = await src('web/src/diagrams/validate.js');
  const dir = path.join(root, 'web', 'src', 'diagrams');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) throw new Error('no diagrams found');
  for (const f of files) {
    const problems = validateDiagram(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    if (problems.length) throw new Error(`${f}: ${problems[0]}`);
  }
  return `${files.length} diagrams`;
});

check('stories use only defined {{cast}} tokens', async () => {
  const { scanStories } = await src('scripts/story-tokens.mjs');
  const found = scanStories(root);
  if (found.missing.length) throw new Error(`undefined: ${found.missing.slice(0, 3).join(', ')}`);
  return `${found.stories} stories, ${found.tokens} tokens`;
});

check('content pack parses and names this demo', () => {
  const pack = JSON.parse(fs.readFileSync(path.join(root, 'content-pack.json'), 'utf8'));
  if (pack.schema !== 'demo-content-pack/1' || pack.demo?.id !== 'privilege-demo') throw new Error('content-pack.json is not this demo\'s demo-content-pack/1');
  return `${pack.id} ${pack.version}`;
});

if ((process.env.DEMO_MODE || '') === 'live') {
  check('live: the configured PingFederate JWKS answers (through the netguard)', async () => {
    const { createApp } = await src('server/src/app.js');
    const { config, liveProblems } = await src('server/src/config.js');
    const cfg = config();
    const problems = liveProblems(cfg);
    if (problems.length) throw new Error(problems.join('; '));
    const app = createApp({ cfg });
    const http1 = http.createServer(app);
    await new Promise((resolve) => http1.listen(0, '127.0.0.1', resolve));
    try {
      const body = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: http1.address().port, path: '/api/preflight', timeout: 8000 }, (res) => { let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve(JSON.parse(t))); }).on('error', () => resolve(null)));
      const jwks = body?.checks?.find((c) => c.id === 'pf-jwks');
      if (!jwks?.ok) throw new Error('the PingFederate JWKS did not answer; check PF_URL (names only, no value shown)');
      return 'JWKS has keys';
    } finally { http1.closeAllConnections(); http1.close(); }
  });
}

let failed = 0;
for (const { name, fn } of checks) {
  try {
    const detail = await fn();
    console.log(`ok    ${name}${detail ? `: ${detail}` : ''}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);

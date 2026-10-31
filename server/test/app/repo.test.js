// The repo itself, against the standalone rules: README standard, shelf entry, content pack, CI, scripts. Reads files only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO } from '../../src/app.js';
import { scanStories } from '../../../scripts/story-tokens.mjs';

const root = path.resolve(new URL('../../../', import.meta.url).pathname);
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const family = path.join(os.homedir(), 'Development');

describe('README standard', () => {
  const readme = read('README.md');
  it('title ends in LAB; tier, repo and catalog lines are there', () => {
    expect(readme.split('\n')[0]).toMatch(/^# .* LAB$/);
    expect(readme).toMatch(/^Tier: Demo$/m);
    expect(readme).toMatch(/^Repo: https:\/\/github\.com\/ping-sandbox\/privilege-demo-LAB$/m);
    expect(readme).toMatch(/^Catalog: D1\b/m);
  });
  it('has the sections in the standard order', () => {
    const headings = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    const wanted = ['What is simulated', 'Run from a clone', 'Settings file', 'Ports, and what to do if the port is taken', 'Mock and live modes', 'Health, doctor and reset', 'Docker (optional)', 'Tests', 'Troubleshooting', 'Ownership'];
    let at = -1;
    for (const h of wanted) { const i = headings.indexOf(h); expect(i, h).toBeGreaterThan(at); at = i; }
  });
  it('port text names the real variables and ports, and lists no reserved port as ours', () => {
    expect(readme).toMatch(/listens on 4510 \(set with PORT, default 4510\)/);
    expect(readme).toMatch(/lsof -iTCP:4510 -sTCP:LISTEN -n -P/);
    expect(readme).toMatch(/4760-4769/);
    expect(readme).toMatch(/Do not use 8080, 5173, 3000, 4000, 4400, 4600-4601, 18080, 19080 or 19090/);
  });
  it('mentions doctor, reset, health and Docker publishing on 127.0.0.1 only; lists no admin or worker key', () => {
    for (const word of ['npm run doctor', 'npm run reset', '/api/health', 'demo-health/1', '127.0.0.1 only']) expect(readme).toContain(word);
    expect(readme).not.toMatch(/PINGONE_ADMIN|CLIENT_SECRET|WORKER_CLIENT|VAULT_PASSWORD/);
  });
  it('carries no internal host, tenant or personal name', () => {
    expect(readme).not.toMatch(/ping-devops|pingcorp|cmuir|\.internal\b|amazonaws|arn:aws/i);
  });
});

describe('shelf entry and content pack', () => {
  const shelf = json('docs/shelf-entry.json');
  const pack = json('content-pack.json');
  it('the shelf entry has a relative composeFile, the health path and the catalog id', () => {
    expect(shelf).toMatchObject({ id: DEMO.id, name: DEMO.name, kind: 'Demo', healthPath: '/api/health', composeFile: 'docker-compose.yml', port: 4510, catalogId: 'D1' });
    expect(path.isAbsolute(shelf.composeFile)).toBe(false);
    expect(fs.existsSync(path.join(root, shelf.composeFile))).toBe(true);
    expect(shelf.url).toBe('http://127.0.0.1:4510');
  });
  it('the content pack is this demo, with the same catalog id, and every story it lists exists', () => {
    expect(pack.schema).toBe('demo-content-pack/1');
    expect(pack.demo).toMatchObject({ id: DEMO.id, name: DEMO.name, catalog: shelf.catalogId, doctor: '/api/health' });
    expect(pack.version).toBe(DEMO.version);
    expect(pack.source.repo).toBe('ping-sandbox/privilege-demo-LAB');
    for (const s of pack.stories) {
      const file = json(s.file);
      expect(file.id).toBe(s.id);
      expect(fs.existsSync(path.join(root, s.file))).toBe(true);
    }
    const shipped = [...fs.readdirSync(path.join(root, 'web/src/data/stories')), ...fs.readdirSync(path.join(root, 'web/src/data/packs/utility/stories'))].length;
    expect(pack.stories).toHaveLength(shipped);
  });
  it('the pack carries no token-shaped strings and links only to public spec sites', () => {
    const text = read('content-pack.json');
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
    for (const s of pack.sources) expect(s.url).toMatch(/^https:\/\/(docs\.cedarpolicy\.com|www\.rfc-editor\.org|modelcontextprotocol\.io|www\.w3\.org)\//);
  });
  it('passes the Learning Hub validator when the hub checkout is present', async () => {
    const file = path.join(family, 'learning-hub/server/src/validate.js');
    if (!fs.existsSync(file)) return;
    const { validatePack } = await import(pathToFileURL(file).href);
    const res = validatePack(pack);
    expect(res.problems ?? []).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

describe('stories and customer.config', () => {
  it('every {{cast}} token in every story is defined by every vertical it can be shown with (rule 10)', () => {
    const found = scanStories(root);
    expect(found.stories).toBeGreaterThanOrEqual(10);
    expect(found.tokens).toBeGreaterThan(0);
    expect(found.missing).toEqual([]);
  });
  it('the scan notices an undefined token', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-story-'));
    fs.mkdirSync(path.join(dir, 'web/src/data/stories'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'web/src/data/verticals'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'web/src/data/stories/S01.json'), JSON.stringify({ id: 'S01', title: '{{nobody}} and {{vocab.nothing}}' }));
    fs.writeFileSync(path.join(dir, 'web/src/data/verticals/v.json'), JSON.stringify({ id: 'v', cast: { mark: { name: 'Mark' } }, vocab: { org: 'x' } }));
    expect(scanStories(dir).missing).toEqual(['S01 uses {{nobody}} which v lacks', 'S01 uses {{vocab.nothing}} which v lacks']);
  });
  it('customer.config.json is gitignored and never shipped', () => {
    expect(read('.gitignore')).toMatch(/^customer\.config\.json$/m);
    expect(fs.existsSync(path.join(root, 'customer.config.json'))).toBe(false);
  });
});

describe('CI, scripts and what is not shipped', () => {
  const ci = read('.github/workflows/ci.yml');
  it('CI runs on hosted ubuntu runners with Node 22 only, and has build, test, doctor, forbidden-strings and gitleaks jobs', () => {
    expect(ci).not.toMatch(/self-hosted|macOS|vars\.RUNS_ON/);
    expect([...ci.matchAll(/runs-on:\s*(.+)/g)].every((m) => m[1].trim() === 'ubuntu-latest')).toBe(true);
    expect([...ci.matchAll(/node-version:\s*(\d+)/g)].every((m) => m[1] === '22')).toBe(true);
    expect(ci).toMatch(/actions\/checkout@v5/);
    expect(ci).toMatch(/actions\/setup-node@v5/);
    for (const job of ['build', 'test', 'doctor', 'forbidden-strings', 'gitleaks']) expect(ci, job).toMatch(new RegExp(`^  ${job}:`, 'm'));
    expect(ci).toMatch(/npm run doctor/);
    expect(ci).toMatch(/secrets\.FORBIDDEN_STRINGS/);
    expect(ci).not.toMatch(/echo .*\$FORBIDDEN_STRINGS|cat .*forbidden/); // counts only; the list is never printed
  });
  it('requires Node 22 everywhere and has no k8s, deploy or hosted-build material', () => {
    for (const f of ['package.json', 'server/package.json', 'web/package.json']) expect(json(f).engines.node, f).toBe('>=22');
    for (const d of ['k8s', 'deploy']) expect(fs.existsSync(path.join(root, d)), d).toBe(false);
    expect(json('package.json').scripts.start).toBe('node scripts/start.mjs');
  });
  it('no source file generates an EC key with crypto.generateKeyPair(Sync)', () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(root).filter((x) => /\.(m?js|jsx)$/.test(x) && !/repo\.test\.js$/.test(x))) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/generateKeyPair(Sync)?\(\s*['"]ec['"]/);
  });
  it('no test script uses a directory with node --test (globs only)', () => {
    const scripts = Object.values(json('package.json').scripts).join(' ');
    expect(scripts).not.toMatch(/node --test\s+\S*[/]\s/);
  });
  it('the vendored PingFederate installer is identical to the family copy, and holds no licence', () => {
    const copy = path.join(root, 'scripts/pingfederate-setup.sh');
    expect(fs.existsSync(copy)).toBe(true);
    const canonical = path.join(family, 'AI-DEMO-Standalone/scripts/pingfederate-setup.sh');
    if (fs.existsSync(canonical)) expect(fs.readFileSync(copy)).toEqual(fs.readFileSync(canonical));
    const files = fs.readdirSync(root, { recursive: true }).filter((f) => !/node_modules|\.git\//.test(f));
    expect(files.filter((f) => /\.lic$/.test(f))).toEqual([]);
  });
  it('the stub issuer is behind a compose profile, so the default stack is one container', () => {
    expect(read('docker-compose.yml')).toMatch(/stub-issuer:\n\s+profiles: \["stub"\]/);
  });
});

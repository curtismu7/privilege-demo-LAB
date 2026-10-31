// npm run check:diagrams: opens every diagram in a headless browser at three widths and runs the family's label-overlap detector
// (AI-DEMO-Standalone/scripts/diagram-overlap.js; DIAGRAM_OVERLAP names another path) in the page. Zero overlapping labels, zero
// duplicated labels and zero labels on top of a box is the pass. It starts the built app itself on a test port (4760-4769) with a
// throwaway DATA_DIR. Needs: npm run build, and Chromium (npx playwright install chromium) or Google Chrome.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const detector = process.env.DIAGRAM_OVERLAP || path.join(os.homedir(), 'Development/AI-DEMO-Standalone/scripts/diagram-overlap.js');
if (!fs.existsSync(detector)) { console.error(`the overlap detector is not at ${detector}; set DIAGRAM_OVERLAP`); process.exit(2); }
if (!fs.existsSync(path.join(root, 'web/dist/index.html'))) { console.error('web/dist is missing. Fix: npm run build'); process.exit(2); }
const { chromium } = await import('playwright');
const diagrams = fs.readdirSync(path.join(root, 'web/src/diagrams')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(root, 'web/src/diagrams', f), 'utf8')));

const freePort = async () => {
  for (let port = 4760; port <= 4769; port++) {
    if (await new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); })) return port;
  }
  throw new Error('no free port in 4760-4769');
};
const port = await freePort();
const server = spawn(process.execPath, ['server/src/index.js'], { cwd: root, stdio: 'ignore',
  env: { PATH: process.env.PATH, HOME: process.env.HOME, STANDALONE_ENV: '/nonexistent/none.env', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'pd-diag-')) } });
const BASE = `http://127.0.0.1:${port}`;
for (let i = 0; !(await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)); i++) {
  if (i > 60) { server.kill(); console.error('the app did not start'); process.exit(1); }
  await new Promise((r) => setTimeout(r, 250));
}
let failed = 0;
let browser;
try {
  for (const opts of [{}, { channel: 'chromium' }, { channel: 'chrome' }]) { try { browser = await chromium.launch(opts); break; } catch { /* next */ } }
  if (!browser) throw new Error('no browser found. Fix: npx playwright install chromium');
  const code = fs.readFileSync(detector, 'utf8');
  for (const [name, width, height] of [['desktop', 1400, 900], ['tablet', 900, 800], ['phone', 375, 800]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${BASE}/diagram`);
    await page.waitForLoadState('networkidle');
    for (const d of diagrams) {
      await page.getByRole('button', { name: d.title, exact: true }).click();
      await page.waitForTimeout(700);
      const r = await page.evaluate(code);
      const ok = r.overlaps.length === 0 && r.duplicates.length === 0 && r.nodeHits.length === 0;
      if (!ok) failed += 1;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(7)} ${d.id}: ${r.overlaps.length} overlapping, ${r.duplicates.length} duplicate, ${r.nodeHits.length} on a box`);
    }
    await page.close();
  }
} finally { await browser?.close(); server.kill(); }
process.exit(failed ? 1 : 0);

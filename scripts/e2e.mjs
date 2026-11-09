// End-to-end browser run of the stories S04, S01, S05 and S23 against the HOST-RUN app (mock mode, offline). Run by hand:
//   npm run e2e            (needs: npm install, npm run build, and a Chromium: npx playwright install chromium)
// It starts the server itself on a free port with a throwaway DATA_DIR, drives it through Playwright, saves screenshots to
// e2e-output/ and exits 1 on the first broken expectation. It is not part of `npm test` or CI. No network beyond loopback.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'e2e-output');
if (!fs.existsSync(path.join(root, 'web/dist/index.html'))) { console.error('web/dist is missing. Fix: npm run build'); process.exit(1); }
let chromium;
try { ({ chromium } = await import('playwright')); } catch { console.error('playwright is not installed. Fix: npm install'); process.exit(1); }

// Test ports for this app are 4760-4769 only: the first one that is free.
const freePort = async () => {
  for (let port = 4760; port <= 4769; port++) {
    if (await new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); })) return port;
  }
  throw new Error('no free port in 4760-4769');
};
const port = await freePort();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-e2e-'));
fs.writeFileSync(path.join(dataDir, 'ALLOW_ADMIN_PERSONA'), 'on'); // Dana exists for this run only
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const env = { PATH: process.env.PATH, HOME: process.env.HOME, STANDALONE_ENV: '/nonexistent/none.env', DEMO_MODE: 'mock', ALLOW_MOCK_SIGNIN: '1', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDir, NODE_ENV: '' };
const server = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const BASE = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) {
  if (await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)) break;
  if (i > 60 || server.exitCode !== null) { console.error(`server did not start:\n${serverLog}`); server.kill(); process.exit(1); }
  await new Promise((r) => setTimeout(r, 250));
}

let browser;
const results = [];
const consoleProblems = []; // every browser console error and uncaught page error, from every page of every user
const step = async (name, fn) => {
  try { await fn(); results.push([true, name]); console.log(`PASS  ${name}`); } catch (e) { results.push([false, name]); console.log(`FAIL  ${name}\n      ${String(e.message).split('\n')[0]}`); throw e; }
};
const eq = (got, want, what) => { if (got !== want) throw new Error(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); };
const has = (text, part, what) => { if (!text.includes(part)) throw new Error(`${what}: expected to contain ${JSON.stringify(part)}, got ${JSON.stringify(text.slice(0, 200))}`); };

try {
  // Playwright's own Chromium (npx playwright install chromium), else the installed Google Chrome.
  for (const opts of [{}, { channel: 'chromium' }, { channel: 'chrome' }]) {
    try { browser = await chromium.launch(opts); break; } catch { /* try the next */ }
  }
  if (!browser) throw new Error('no browser found. Fix: npx playwright install chromium (or install Google Chrome)');
  const newUser = async (persona, label) => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleProblems.push(`${label}: ${m.text()}`); });
    page.on('pageerror', (e) => consoleProblems.push(`${label}: uncaught ${e.message}`));
    await page.goto(`${BASE}/`);
    await page.getByRole('button', { name: new RegExp(persona, 'i') }).click();
    await page.getByTestId('shell-user').waitFor();
    eq(await page.getByTestId('shell-user').locator('strong').innerText(), persona, `${label} signed in as`);
    return { ctx, page };
  };
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });

  // One call from the Tool console. Reloads the page first so the result card is always the new one.
  async function call(page, tool, args = {}, { dot = false, justification } = {}) {
    await page.goto(`${BASE}/console`);
    await page.locator('#main select').first().selectOption(tool);
    for (const [k, v] of Object.entries(args)) await page.locator('label.field', { hasText: new RegExp(`^${k}`) }).locator('input').fill(String(v));
    if (dot) await page.getByLabel(/Dot \(Mark's agent\)/).check();
    if (justification) await page.locator('label.field', { hasText: /^Justification/ }).locator('input').fill(justification);
    await page.getByRole('button', { name: /^Call as/ }).click();
    const card = page.getByRole('region', { name: 'PEP decision' });
    await card.waitFor();
    // The raw facts (deciding policy, attribution, approvers) sit under "Technical details"; open them so this script can read them.
    const tech = card.locator('details.explain__tech > summary');
    if (await tech.count()) await tech.first().click();
    const text = await card.innerText();
    const badge = await card.locator('.badge').first().textContent();
    const rule = await card.locator('dd code').first().innerText();
    return { card, text, badge, rule };
  }

  // ---- S04: two of three tools (Mary, analyst) ----
  await step('S04 Mary gets Search and Ticketing, not Payments or Booking', async () => {
    const mary = await newUser('Mary', 'Mary');
    let r = await call(mary.page, 'search_flights', { query: 'SFO to JFK' });
    eq(r.badge, 'Allow', 'search'); eq(r.rule, 's04-analysts-search-ticketing', 'search rule');
    has(r.text, 'FL100', 'tool result shown');
    await shot(mary.page, 'S04-1-search-allowed');
    r = await call(mary.page, 'create_ticket', { subject: 'Seat change' });
    eq(r.badge, 'Allow', 'ticket');
    await shot(mary.page, 'S04-2-ticket-allowed');
    r = await call(mary.page, 'pay_invoice', { invoiceId: 'INV-1', amount: 250 });
    eq(r.badge, 'Deny', 'payments'); eq(r.rule, 'default-deny', 'payments rule');
    has(r.text, 'none', 'nothing overridden');
    await shot(mary.page, 'S04-3-payments-denied');
    r = await call(mary.page, 'book_fare', { flightId: 'FL200', amount: 500 });
    eq(r.badge, 'Deny', 'booking by an analyst');
    await mary.ctx.close();
  });

  // ---- S01: second pair of eyes (two browser contexts) ----
  await step('S01 Mark asks Dot to book 2,400: held; Priya approves; it runs once', async () => {
    const mark = await newUser('Mark', 'Mark');
    const priya = await newUser('Priya', 'Priya'); // a second, separate browser context
    const held = await call(mark.page, 'book_fare', { flightId: 'FL200', amount: 2400 }, { dot: true, justification: 'Customer rebooked after a cancellation' });
    eq(held.badge, 'Hold', 'booking by Dot'); eq(held.rule, 's01-hold-large-fare', 'hold rule');
    has(held.text, 'Priya', 'approver named');
    await shot(mark.page, 'S01-1-mark-held');

    await priya.page.goto(`${BASE}/approvals`);
    await priya.page.getByRole('button', { name: 'Approve book_fare' }).waitFor();
    has(await priya.page.getByRole('listitem').first().innerText(), 'Customer rebooked after a cancellation', 'justification shown to the approver');
    await shot(priya.page, 'S01-2-priya-sees-request');

    await mark.page.goto(`${BASE}/approvals`);
    // The list loads after the page mounts: wait for Mark's request to render before checking what he can do with it.
    await mark.page.getByRole('listitem').filter({ hasText: 'Customer rebooked after a cancellation' }).first().waitFor({ timeout: 10_000 });
    eq(await mark.page.getByRole('button', { name: 'Approve book_fare' }).count(), 0, 'Mark has an Approve button for his own request');
    has(await mark.page.locator('body').innerText(), 'someone else has to answer it', 'requester told to wait');
    await shot(mark.page, 'S01-3-mark-cannot-self-approve');

    await priya.page.getByRole('button', { name: 'Approve book_fare' }).click();
    await priya.page.getByText('Approved the book_fare request.').waitFor();
    has(await priya.page.getByRole('region', { name: 'Tool result' }).or(priya.page.getByLabel('Tool result')).innerText(), 'BK-', 'booking confirmation');
    await shot(priya.page, 'S01-4-priya-approved');

    await mark.page.goto(`${BASE}/approvals`);
    await mark.page.getByText('the tool ran').waitFor();
    await shot(mark.page, 'S01-5-mark-sees-outcome');
    await mark.ctx.close(); await priya.ctx.close();
  });

  // ---- S23: forbid beats permit (Mark; Dana shows the policies) ----
  await step('S23 Mark books 10,001: the hard cap denies it and names the permit it overrode', async () => {
    const mark = await newUser('Mark', 'Mark');
    let r = await call(mark.page, 'book_fare', { flightId: 'FL200', amount: 500 });
    eq(r.badge, 'Allow', 'a normal booking'); eq(r.rule, 's23-permit-travel-agents', 'permit rule');
    r = await call(mark.page, 'book_fare', { flightId: 'FL200', amount: 10001 });
    eq(r.badge, 'Deny', 'over the cap'); eq(r.rule, 's23-forbid-over-cap', 'cap rule');
    has(r.text, 's23-permit-travel-agents', 'overridden permit named');
    await shot(mark.page, 'S23-1-cap-denies');
    await mark.ctx.close();
    const dana = await newUser('Dana', 'Dana');
    await dana.page.goto(`${BASE}/policies`);
    await dana.page.getByRole('heading', { name: 'Policies', exact: true }).waitFor();
    await dana.page.getByText('s23-forbid-over-cap').first().waitFor(); // the policy list has loaded
    await shot(dana.page, 'S23-2-ai-policies');
    await dana.ctx.close();
  });

  // ---- S05: rug pull (Dana changes a tool's schema, Mary is refused) ----
  await step('S05 Dana makes search_flights drift: Mary is denied by the pin; restoring clears it', async () => {
    const dana = await newUser('Dana', 'Dana');
    const mary = await newUser('Mary', 'Mary');
    await dana.page.goto(`${BASE}/console`);
    const row = dana.page.getByRole('listitem').filter({ hasText: 'search_flights' });
    await row.getByRole('button', { name: 'Make schema drift' }).click();
    await dana.page.getByText('search_flights schema drifted.').waitFor();
    await shot(dana.page, 'S05-1-dana-drifted');
    const r = await call(mary.page, 'search_flights', { query: 'SFO to JFK' });
    eq(r.badge, 'Deny', 'drifted tool'); eq(r.rule, 's05-rugpull-pin', 'pin rule');
    await shot(mary.page, 'S05-2-mary-denied');
    await row.getByRole('button', { name: 'Restore schema' }).click();
    await dana.page.getByText('search_flights schema restored.').waitFor();
    const again = await call(mary.page, 'search_flights', { query: 'SFO to JFK' });
    eq(again.badge, 'Allow', 'after restore');
    await shot(mary.page, 'S05-3-restored');
    await dana.ctx.close(); await mary.ctx.close();
  });

  // ---- Try this: each button fills in the form (no call yet); pressing Call gives exactly what is printed beside it ----
  const TRY = JSON.parse(fs.readFileSync(path.join(root, 'web/src/data/tryThis.generic.json'), 'utf8')).filter((s) => !s.exampleOnly);
  const NAMES = { mark: 'Mark', mary: 'Mary', priya: 'Priya' };
  const WORD = { allow: 'Allow', deny: 'Deny', hold: 'Hold' };
  const filled = (t) => t.replace(/\{\{(\w+)\}\}/g, (_m, k) => NAMES[k] ?? `<${k}>`);
  await step('Try this: every button fills the form without calling, and Call gives the printed outcome and rule', async () => {
    const users = { mark: await newUser('Mark', 'Mark'), mary: await newUser('Mary', 'Mary') };
    for (const s of TRY) {
      const { page } = users[s.as];
      await page.goto(`${BASE}/console`);
      has((await page.locator('#main').innerText()).toLowerCase(), `expect: ${WORD[s.expect.outcome].toLowerCase()}`, `${s.id} states what to expect`); // the chip is upper-cased by CSS
      await page.getByRole('button', { name: filled(s.label), exact: true }).click();
      eq(await page.getByRole('region', { name: 'PEP decision' }).count(), 0, `${s.id}: nothing was called yet`);
      eq(await page.locator('label.field', { hasText: /^Tool/ }).first().locator('select').inputValue(), s.tool, `${s.id}: tool filled`);
      eq((await page.getByLabel(/Dot \(Mark's agent\)/).isChecked()), s.agent === true, `${s.id}: agent box`);
      await page.getByRole('button', { name: /^Call as/ }).click();
      const card = page.getByRole('region', { name: 'PEP decision' });
      await card.waitFor();
      eq(await card.locator('.badge').first().textContent(), WORD[s.expect.outcome], `${s.id} outcome`);
      await card.locator('details.explain__tech > summary').first().click();
      eq(await card.locator('dd code').first().innerText(), s.expect.rule, `${s.id} deciding rule`);
      has((await card.innerText()).toLowerCase(), 'rules checked', `${s.id} lists the rules`); // headings are upper-cased by CSS
      if (s.id === 'large-fare-unattended') await shot(page, 'TRY-held-card');
    }
    await users.mark.ctx.close(); await users.mary.ctx.close();
  });

  // ---- the card at 375 px in light and dark, and presenter mode makes it bigger ----
  await step('the decision card has no sideways scroll at 375 px (light and dark) and grows in presenter mode', async () => {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, colorScheme: theme });
      await ctx.addInitScript((t) => { try { localStorage.setItem('privdemo.theme', t); } catch { /* none */ } }, theme);
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') consoleProblems.push(`375 ${theme}: ${m.text()}`); });
      page.on('pageerror', (e) => consoleProblems.push(`375 ${theme}: uncaught ${e.message}`));
      await page.goto(`${BASE}/`);
      await page.getByRole('button', { name: /^Mark/i }).click();
      await page.getByTestId('shell-user').waitFor();
      await call(page, 'book_fare', { flightId: 'FL200', amount: 12000 });
      const wide = async (what) => { const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); if (w[0] > w[1] + 1) throw new Error(`${what} (${theme}) scrolls sideways: ${w[0]} > ${w[1]}`); };
      await wide('console with a decision');
      await shot(page, `375-${theme}-console`);
      for (const p of ['/policies', '/approvals', '/trace']) { await page.goto(`${BASE}${p}`); await page.waitForLoadState('networkidle'); await wide(p); }
      await page.goto(`${BASE}/console`);
      await ctx.close();
    }
    const mark = await newUser('Mark', 'Mark');
    await call(mark.page, 'book_fare', { flightId: 'FL200', amount: 12000 });
    const size = () => mark.page.locator('.explain').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const before = await size();
    await mark.page.getByRole('button', { name: 'Presenter' }).click();
    const after = await size();
    if (!(after > before)) throw new Error(`presenter mode did not grow the explanation text: ${before}px -> ${after}px`);
    await mark.ctx.close();
  });

  // ---- the other pages render ----
  await step('Learn, Diagram and Trace pages load', async () => {
    const dana = await newUser('Dana', 'Dana');
    for (const [p, h] of [['/learn', 'Learn'], ['/diagram', 'Diagram'], ['/trace', 'Trace']]) {
      await dana.page.goto(`${BASE}${p}`);
      await dana.page.getByRole('heading', { level: 1, name: h }).waitFor();
      await shot(dana.page, `page-${h.toLowerCase()}`);
    }
    await dana.ctx.close();
  });

  // ---- the browser console stays clean: a Deny, a refused Live switch and a signed-out load are normal results, not errors ----
  await step('the browser console had no errors (Allow, Hold, Deny, approvals, drift, every page)', async () => {
    const anon = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await anon.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleProblems.push(`signed out: ${m.text()}`); });
    page.on('pageerror', (e) => consoleProblems.push(`signed out: uncaught ${e.message}`));
    for (const p of ['/', '/policies', '/console', '/approvals', '/trace', '/learn', '/diagram']) { await page.goto(`${BASE}${p}`); await page.waitForLoadState('networkidle'); }
    await page.goto(`${BASE}/`);
    await page.getByRole('button', { name: 'Live' }).click();
    await page.getByRole('alert').waitFor(); // the fix text is shown
    await anon.close();
    if (consoleProblems.length) throw new Error(`${consoleProblems.length} console problem(s), first: ${consoleProblems[0]}`);
  });
} catch (e) {
  console.log(`\nStopped at the first failure: ${e.message}`);
} finally {
  await browser?.close();
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} steps passed; screenshots in ${path.relative(root, OUT)}/ (${fs.readdirSync(OUT).length} files)`);
process.exit(failed || results.length < 5 ? 1 : 0);

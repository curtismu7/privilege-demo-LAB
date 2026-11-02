// Browser run of the utility / NERC CIP-style pack (PACK=utility) on the HOST-RUN app (mock mode, offline). Run by hand:
//   npm run build && npm run e2e:utility        (needs a Chromium: npx playwright install chromium, or Google Chrome)
// Starts the server itself (default port 4762, E2E_PORT to change; never a port in use) with a throwaway DATA_DIR, drives the five
// pack stories in a real browser, then sweeps every page in light and dark at desktop and 375 px (no sideways scroll, the
// "invented groups / mock backends" notice present). Screenshots go to e2e-output/utility/. Not part of `npm test` or CI.
// The groups are INVENTED and every backend is a MOCK; this script checks the page says so.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'e2e-output', 'utility');
if (!fs.existsSync(path.join(root, 'web/dist/index.html'))) { console.error('web/dist is missing. Fix: npm run build'); process.exit(1); }
let chromium;
try { ({ chromium } = await import('playwright')); } catch { console.error('playwright is not installed. Fix: npm install'); process.exit(1); }

const port = Number(process.env.E2E_PORT) || 4762;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-e2e-utility-'));
fs.writeFileSync(path.join(dataDir, 'ALLOW_ADMIN_PERSONA'), 'on');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const env = { PATH: process.env.PATH, HOME: process.env.HOME, STANDALONE_ENV: '/nonexistent/none.env', DEMO_MODE: 'mock', ALLOW_MOCK_SIGNIN: '1', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDir, NODE_ENV: '', PACK: 'utility' };
const server = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const BASE = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) {
  if (await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)) break;
  if (i > 60 || server.exitCode !== null) { console.error(`server did not start (is port ${port} busy? set E2E_PORT):\n${serverLog}`); server.kill(); process.exit(1); }
  await new Promise((r) => setTimeout(r, 250));
}

let browser;
let failed = false;
const step = async (name, fn) => {
  try { await fn(); console.log(`PASS  ${name}`); } catch (e) { failed = true; console.log(`FAIL  ${name}\n      ${String(e.message).split('\n')[0]}`); throw e; }
};
const eq = (got, want, what) => { if (got !== want) throw new Error(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); };
const has = (text, part, what) => { if (!text.includes(part)) throw new Error(`${what}: expected to contain ${JSON.stringify(part)}, got ${JSON.stringify(text.slice(0, 240))}`); };

try {
  for (const opts of [{}, { channel: 'chromium' }, { channel: 'chrome' }]) {
    try { browser = await chromium.launch(opts); break; } catch { /* try the next */ }
  }
  if (!browser) throw new Error('no browser found. Fix: npx playwright install chromium (or install Google Chrome)');

  const newUser = async (persona, { theme = 'light', width = 1200, height = 900 } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
    await ctx.addInitScript((t) => { try { localStorage.setItem('privdemo.theme', t); } catch { /* none */ } }, theme);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    await page.getByRole('button', { name: new RegExp(`^${persona}`, 'i') }).click();
    await page.getByTestId('shell-user').waitFor();
    eq(await page.getByTestId('shell-user').locator('strong').innerText(), persona, `${persona} signed in as`);
    return { ctx, page };
  };
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });

  // One call from the Tool console (the delivery agent ticked by default). Enum arguments are lists, the rest are inputs.
  async function call(page, tool, args = {}, { agent = true } = {}) {
    await page.goto(`${BASE}/console`);
    await page.locator('label.field', { hasText: /^Tool/ }).first().locator('select').selectOption(tool);
    for (const [k, v] of Object.entries(args)) {
      const field = page.locator('label.field', { hasText: new RegExp(`^${k}`) });
      if (await field.locator('select').count()) await field.locator('select').selectOption(String(v)); else await field.locator('input').fill(String(v));
    }
    const box = page.getByRole('checkbox', { name: /Delivery agent/ });
    if ((await box.isChecked()) !== agent) await box.setChecked(agent);
    await page.getByRole('button', { name: /^Call as/ }).click();
    const card = page.getByRole('region', { name: 'PEP decision' });
    await card.waitFor();
    // The raw facts (deciding policy, attribution, approvers) sit under "Technical details"; open them so this script can read them.
    const tech = card.locator('details.explain__tech > summary');
    if (await tech.count()) await tech.first().click();
    const text = await card.innerText();
    return { card, text, badge: await card.locator('.badge').first().textContent(), rule: await card.locator('dd code').first().innerText() };
  }
  const OPS = { repo: 'grid-ops-portal', pr: 42 };

  await step('the sign-in page lists the pack people and says the groups are invented and the backends are mocks', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    await page.getByRole('button', { name: /^Cora/ }).waitFor();
    const body = await page.locator('body').innerText();
    for (const n of ['Eli', 'Gwen', 'Ben', 'Cora', 'Priya']) has(body, n, 'persona listed');
    has(body, "'Pull Request Review' is treated as these engineering review rules", 'PR review persona note');
    has(await page.getByTestId('pack-notice').innerText(), 'INVENTED', 'notice says invented');
    has(await page.getByTestId('pack-notice').innerText(), 'MOCK', 'notice says mock');
    eq(await page.getByRole('button', { name: /^Dana/ }).count(), 1, 'Dana appears only because this run created the admin switch file');
    await shot(page, '00-signin');
    await ctx.close();
  });

  await step('S61 Eli reads a PR and posts a comment (allow), the trace names user, agent and tool', async () => {
    const eli = await newUser('Eli');
    let r = await call(eli.page, 'github.read_pr', OPS);
    eq(r.badge, 'Allow', 'read_pr'); eq(r.rule, 'u10-engineers-pr-review', 'read_pr rule');
    has(r.text, 'On behalf of', 'attribution row'); has(r.text, 'user eli via agent delivery-agent', 'user and agent'); has(r.text, 'MOCK', 'mock result labelled');
    await shot(eli.page, 'S61-1-read-pr');
    r = await call(eli.page, 'github.post_review_comment', { ...OPS, body: 'Please add a test' });
    eq(r.badge, 'Allow', 'comment');
    await eli.page.goto(`${BASE}/trace`);
    const row = eli.page.getByRole('list', { name: /Hops/ }).locator('li').first();
    await row.waitFor();
    const t = await row.innerText();
    has(t, 'eli via delivery-agent', 'trace user and agent'); has(t, 'github.post_review_comment', 'trace tool');
    await shot(eli.page, 'S61-2-trace');
    await eli.ctx.close();
  });

  await step('S62 Ben updates a story: held for Priya; she approves and it runs once; a second one she denies', async () => {
    const ben = await newUser('Ben');
    const priya = await newUser('Priya');
    const held = await call(ben.page, 'backlog.update_story', { storyId: 'ST-101', change: 'Move to Ready' });
    eq(held.badge, 'Hold', 'update_story'); eq(held.rule, 'u30-hold-story-update', 'hold rule'); has(held.text, 'Priya', 'approver named');
    await shot(ben.page, 'S62-1-held');
    await priya.page.goto(`${BASE}/approvals`);
    await priya.page.getByRole('button', { name: 'Approve backlog.update_story' }).waitFor();
    has(await priya.page.getByRole('listitem').first().innerText(), 'ben (through delivery-agent)', 'user and agent shown to the approver');
    await shot(priya.page, 'S62-2-priya-sees');
    await priya.page.getByRole('button', { name: 'Approve backlog.update_story' }).click();
    await priya.page.getByText('Approved the backlog.update_story request.').waitFor();
    has(await priya.page.getByLabel('Tool result').innerText(), 'updated', 'mock result');
    await shot(priya.page, 'S62-3-approved');
    const again = await call(ben.page, 'backlog.update_story', { storyId: 'ST-102', change: 'Reword' });
    eq(again.badge, 'Hold', 'second update');
    await priya.page.goto(`${BASE}/approvals`);
    await priya.page.getByRole('button', { name: 'Deny backlog.update_story' }).click();
    await priya.page.getByText('Denied the backlog.update_story request.').waitFor();
    await shot(priya.page, 'S62-4-denied');
    await ben.ctx.close(); await priya.ctx.close();
  });

  await step('S63 merge, approve and deploy.* are denied for everyone, no approval is ever created', async () => {
    const eli = await newUser('Eli');
    const gwen = await newUser('Gwen');
    const priya = await newUser('Priya');
    let r = await call(eli.page, 'github.merge_pr', OPS);
    eq(r.badge, 'Deny', 'merge'); eq(r.rule, 'u20-never-merge-or-approve-pr', 'merge rule');
    await shot(eli.page, 'S63-1-merge-denied');
    r = await call(gwen.page, 'github.approve_pr', OPS);
    eq(r.badge, 'Deny', 'approve'); eq(r.rule, 'u20-never-merge-or-approve-pr', 'approve rule');
    for (const t of ['deploy.production', 'deploy.staging', 'deploy.rollback']) {
      r = await call(priya.page, t, { service: 'grid-ops-portal' });
      eq(r.badge, 'Deny', t); eq(r.rule, 'u22-never-deploy', `${t} rule`);
    }
    await shot(priya.page, 'S63-2-deploy-denied');
    await priya.page.goto(`${BASE}/approvals`);
    await priya.page.getByRole('list', { name: 'Approval requests' }).waitFor(); // S62's two decided requests are still listed
    const queue = await priya.page.locator('body').innerText();
    for (const t of ['github.merge_pr', 'github.approve_pr', 'deploy.']) if (queue.includes(t)) throw new Error(`an approval request exists for ${t}`);
    // what-if with approvals already given: still deny (Test a request on AI Policies)
    await eli.page.goto(`${BASE}/policies`);
    await eli.page.locator('label.field', { hasText: /^Who/ }).locator('select').selectOption('ben');
    await eli.page.locator('label.field', { hasText: /^Tool/ }).first().locator('select').selectOption('github.merge_pr');
    await eli.page.getByLabel('Approvals already given').fill('3');
    await eli.page.getByRole('button', { name: 'Test request' }).click();
    const card = eli.page.getByRole('region', { name: 'Decision' });
    await card.waitFor();
    has(await card.innerText(), 'u20-never-merge-or-approve-pr', 'still denied with 3 approvals');
    eq(await card.locator('.badge').first().textContent(), 'Deny', 'what-if outcome');
    await shot(eli.page, 'S63-3-no-override');
    await eli.ctx.close(); await gwen.ctx.close(); await priya.ctx.close();
  });

  await step('S64 restricted evidence: Eli is denied by classification, Cora is allowed', async () => {
    const eli = await newUser('Eli');
    const cora = await newUser('Cora');
    const kb = { query: 'CIP-007 patch evidence', collection: 'audit-evidence' };
    let r = await call(eli.page, 'kb.search', kb);
    eq(r.badge, 'Deny', 'Eli'); eq(r.rule, 'u41-restricted-evidence-compliance-only', 'rule'); has(r.text, 'u11-engineers-research', 'overridden permit named');
    await shot(eli.page, 'S64-1-denied');
    r = await call(cora.page, 'kb.search', kb);
    eq(r.badge, 'Allow', 'Cora'); eq(r.rule, 'u14-compliance-evidence', 'rule');
    await shot(cora.page, 'S64-2-allowed');
    await eli.ctx.close(); await cora.ctx.close();
  });

  await step('S65 repo scoping: Eli is denied outside his repos, Gwen reads any repo', async () => {
    const eli = await newUser('Eli');
    const gwen = await newUser('Gwen');
    const other = { repo: 'meter-data-lake', pr: 7 };
    let r = await call(eli.page, 'github.read_pr', other);
    eq(r.badge, 'Deny', 'Eli'); eq(r.rule, 'u40-repo-scope-engineers', 'rule');
    await shot(eli.page, 'S65-1-denied');
    r = await call(gwen.page, 'github.read_pr', other);
    eq(r.badge, 'Allow', 'Gwen'); eq(r.rule, 'u12-governance-review', 'rule');
    await eli.ctx.close(); await gwen.ctx.close();
  });

  await step('AI Policies shows the grid and the pack scenarios, every cell filled', async () => {
    const eli = await newUser('Eli');
    await eli.page.goto(`${BASE}/policies`);
    const grid = eli.page.getByRole('table', { name: 'Decision for each group and tool' });
    await grid.waitFor();
    await eli.page.getByRole('table', { name: 'Scenario decisions' }).waitFor();
    await eli.page.waitForFunction(() => !document.body.innerText.includes('…'));
    has(await eli.page.locator('body').innerText(), 'Cases the grid cannot show', 'scenarios section');
    await shot(eli.page, 'policies-grid');
    await eli.ctx.close();
  });

  // ---- Try this (this pack's list): each button fills the form without calling; Call gives the printed outcome and rule ----
  const TRY = JSON.parse(fs.readFileSync(path.join(root, 'server/src/packs/utility/pack.json'), 'utf8')).tryThis.filter((s) => !s.exampleOnly);
  const WORD = { allow: 'Allow', deny: 'Deny', hold: 'Hold' };
  const cast = (t) => t.replace(/\{\{(\w+)\}\}/g, (_m, k) => k[0].toUpperCase() + k.slice(1));
  await step('Try this: every button fills the form without calling, and Call gives the printed outcome and rule', async () => {
    const users = {};
    for (const s of TRY) users[s.as] ??= await newUser(cast(`{{${s.as}}}`));
    for (const s of TRY) {
      const { page } = users[s.as];
      await page.goto(`${BASE}/console`);
      await page.getByRole('button', { name: cast(s.label), exact: true }).click();
      eq(await page.getByRole('region', { name: 'PEP decision' }).count(), 0, `${s.id}: nothing was called yet`);
      eq(await page.locator('label.field', { hasText: /^Tool/ }).first().locator('select').inputValue(), s.tool, `${s.id}: tool filled`);
      await page.getByRole('button', { name: /^Call as/ }).click();
      const card = page.getByRole('region', { name: 'PEP decision' });
      await card.waitFor();
      eq(await card.locator('.badge').first().textContent(), WORD[s.expect.outcome], `${s.id} outcome`);
      await card.locator('details.explain__tech > summary').first().click();
      eq(await card.locator('dd code').first().innerText(), s.expect.rule, `${s.id} deciding rule`);
      has((await card.innerText()).toLowerCase(), 'rules checked', `${s.id} lists the rules`); // headings are upper-cased by CSS
    }
    for (const u of Object.values(users)) await u.ctx.close();
  });

  // ---- the explanation card in presenter mode is bigger ----
  await step('presenter mode grows the explanation text', async () => {
    const eli = await newUser('Eli');
    await call(eli.page, 'github.merge_pr', OPS);
    const size = () => eli.page.locator('.explain').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const before = await size();
    await eli.page.getByRole('button', { name: 'Presenter' }).click();
    const after = await size();
    if (!(after > before)) throw new Error(`presenter mode did not grow the explanation text: ${before}px -> ${after}px`);
    await eli.ctx.close();
  });

  // ---- every page, light and dark, desktop and 375 px: no sideways scroll, the notice is there ----
  for (const theme of ['light', 'dark']) {
    for (const [label, width, height] of [['desktop', 1200, 900], ['375', 375, 800]]) {
      await step(`pages in ${theme} at ${label}: notice shown, no sideways scroll`, async () => {
        const u = await newUser('Eli', { theme, width, height });
        eq(await u.page.evaluate(() => document.documentElement.dataset.theme), theme, 'theme applied');
        for (const p of ['/', '/policies', '/console', '/approvals', '/trace', '/learn', '/diagram']) {
          await u.page.goto(`${BASE}${p}`);
          await u.page.getByTestId('pack-notice').waitFor({ timeout: 5000 }).catch(() => { throw new Error(`no pack notice on ${p} (${theme}, ${label})`); });
          await u.page.waitForTimeout(250);
          const over = await u.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          if (over > 1 && p !== '/diagram') throw new Error(`${p} scrolls sideways by ${over}px at ${width}px (${theme})`);
          await shot(u.page, `pages-${theme}-${label}${p === '/' ? '-signin' : p.replace('/', '-')}`);
        }
        await u.ctx.close();
      });
    }
  }
} catch (e) {
  failed = true;
  console.error(`\nStopped at the first failure: ${String(e.message).split('\n')[0]}`);
} finally {
  await browser?.close();
  server.kill();
}
if (failed) { console.error(`\nServer log:\n${serverLog.slice(-1500)}`); process.exit(1); }
console.log(`\nAll utility pack checks passed. Screenshots: ${path.relative(root, OUT)}/`);

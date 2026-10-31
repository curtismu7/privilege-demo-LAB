// Black-box check of a RUNNING app in LIVE mode with the local stub issuer (not PingFederate): docker compose with the stub profile, or a
// host-run stub (node stub-issuer/server.mjs) with PF_URL pointing at it and DEMO_MODE=live.
//   BASE_URL=http://127.0.0.1:4510 node scripts/smoke.mjs             tokens minted inside the compose stub container
//   BASE_URL=http://127.0.0.1:4761 MINT=local node scripts/smoke.mjs  tokens minted by a host-run stub
// Checks health, the web page, Bearer accept/refuse, and one decision per group x tool cell through POST /mcp.
// Expectations are written out here on purpose: they come from docs/group-to-tool-mapping.md, not from the app's code.
import { execFileSync } from 'node:child_process';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:4510').replace(/\/+$/, '');
const MINT = process.env.MINT || 'docker';

let failed = 0;
let total = 0;
const check = (ok, name, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  -> ${detail}` : ''}`); };

function mint(persona, extra = []) {
  const args = ['stub-issuer/mint.mjs', persona, ...extra];
  const out = MINT === 'local'
    ? execFileSync('node', args, { encoding: 'utf8' })
    : execFileSync('docker', ['compose', '--profile', 'stub', 'exec', '-T', 'stub-issuer', 'node', ...args], { encoding: 'utf8' });
  return out.trim();
}

let rpcId = 1;
async function rpc(token, method, params) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, body };
}
const outcomeOf = (r) => {
  if (r.status !== 200 || !r.body) return { outcome: `http-${r.status}` };
  if (r.body.result) return { outcome: 'allow' };
  const e = r.body.error;
  return { outcome: e?.code === -32004 ? 'hold' : e?.code === -32003 ? 'deny' : `error-${e?.code}`, rule: e?.data?.rule, approvalId: e?.data?.approvalId };
};
const call = (token, name, args) => rpc(token, 'tools/call', { name, arguments: args });

const ARGS = {
  search_flights: { query: 'SFO to JFK' }, create_ticket: { subject: 'Seat change' },
  pay_invoice: { invoiceId: 'INV-1001', amount: 250 }, book_fare: { flightId: 'FL200', amount: 500 },
};
const DEFAULT = 'default-deny';
// group -> [token persona + extra mint flags, expected [outcome, rule] per tool]
const GROUPS = {
  analysts: { persona: 'mary', mint: [], cells: { search_flights: ['allow', 's04-analysts-search-ticketing'], create_ticket: ['allow', 's04-analysts-search-ticketing'], pay_invoice: ['deny', DEFAULT], book_fare: ['deny', DEFAULT] } },
  finance: { persona: 'mark', mint: ['--groups', 'finance', '--scope', 'tools:invoke payments:write'], cells: { search_flights: ['deny', DEFAULT], create_ticket: ['deny', DEFAULT], pay_invoice: ['allow', 's04-payments-finance-only'], book_fare: ['deny', DEFAULT] } },
  'travel-agents': { persona: 'mark', mint: [], cells: { search_flights: ['deny', DEFAULT], create_ticket: ['deny', DEFAULT], pay_invoice: ['deny', DEFAULT], book_fare: ['allow', 's23-permit-travel-agents'] } },
  admins: { persona: 'dana', mint: [], cells: { search_flights: ['deny', DEFAULT], create_ticket: ['deny', DEFAULT], pay_invoice: ['deny', DEFAULT], book_fare: ['deny', DEFAULT] } },
};

// ---- health and web page ----
const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
check(health?.schema === 'demo-health/1' && health?.demo?.id === 'privilege-demo', 'GET /api/health is demo-health/1', JSON.stringify(health));
const page = await fetch(`${BASE}/`).then((r) => r.text()).catch(() => '');
const asset = /src="(\/assets\/[^"]+\.js)"/.exec(page)?.[1];
check(page.includes('id="root"') && Boolean(asset), 'web page loads (index.html with a script bundle)');
const assetRes = asset ? await fetch(`${BASE}${asset}`) : null;
check(assetRes?.status === 200, 'web bundle is served', String(assetRes?.status));
// The stub issuer is for the live path: switch the app to Live (it must already have PF_URL and PF_AUDIENCE pointing at the stub).
if (health?.runtime !== 'live') await fetch(`${BASE}/api/mode`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'live' }) }).catch(() => null);
const cfg = await fetch(`${BASE}/api/auth/config`).then((r) => r.json()).catch(() => ({}));
check(cfg.mode === 'live' && cfg.mockAvailable === false && cfg.bearer === true, 'the app is in live mode with no mock sign-in', JSON.stringify(cfg));
const mock = await fetch(`${BASE}/api/auth/mock/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ persona: 'mark' }) });
check([403, 404].includes(mock.status), 'the mock login is refused in live mode', String(mock.status));
const pre = await fetch(`${BASE}/api/preflight`).then((r) => r.json()).catch(() => null);
check(pre?.ok === true, 'GET /api/preflight is all clear', JSON.stringify(pre?.checks?.filter((c) => !c.ok)));

// ---- Bearer accept / refuse ----
const markToken = mint('mark');
const initialize = await rpc(markToken, 'initialize', { protocolVersion: '2025-11-25' });
check(initialize.status === 200 && initialize.body?.result?.serverInfo, 'a stub-minted Bearer token is accepted');
const [h, p, s] = markToken.split('.');
const flip = (str) => { const i = Math.floor(str.length / 2); return str.slice(0, i) + (str[i] === 'A' ? 'B' : 'A') + str.slice(i + 1); };
check((await rpc(`${h}.${p}.${flip(s)}`, 'tools/list')).status === 401, 'a token with a tampered signature is refused (401)');
check((await rpc(`${h}.${flip(p)}.${s}`, 'tools/list')).status === 401, 'a token with a tampered payload is refused (401)');
check((await rpc(null, 'tools/list')).status === 401, 'no token is refused (401)');
check((await rpc('not.a.token', 'tools/list')).status === 401, 'garbage is refused (401)');

// ---- one decision per plan-mapping cell ----
for (const [group, g] of Object.entries(GROUPS)) {
  const token = mint(g.persona, g.mint);
  for (const [tool, [want, wantRule]] of Object.entries(g.cells)) {
    const got = outcomeOf(await call(token, tool, ARGS[tool]));
    check(got.outcome === want && (want === 'allow' || got.rule === wantRule),
      `${group} -> ${tool}: ${want}${want === 'allow' ? '' : ` (${wantRule})`}`, JSON.stringify(got));
  }
}

// ---- the other plan cells: scope, amounts, unattended, approval ----
const financeNoScope = mint('mark', ['--groups', 'finance']);
let got = outcomeOf(await call(financeNoScope, 'pay_invoice', ARGS.pay_invoice));
check(got.outcome === 'deny' && got.rule === DEFAULT, 'finance without payments:write -> pay_invoice: deny', JSON.stringify(got));
const markToken2 = mint('mark');
got = outcomeOf(await call(markToken2, 'book_fare', { flightId: 'FL200', amount: 2400 }));
check(got.outcome === 'allow', 'travel-agents, attended, fare 2400 -> allow (the hold applies to unattended calls)', JSON.stringify(got));
got = outcomeOf(await call(markToken2, 'book_fare', { flightId: 'FL200', amount: 10001 }));
check(got.outcome === 'deny' && got.rule === 's23-forbid-over-cap', 'fare 10001 -> deny by the hard cap, which overrides the permit', JSON.stringify(got));
const dot = mint('mark', ['--act', 'dot']);
got = outcomeOf(await call(dot, 'book_fare', { flightId: 'FL200', amount: 2400 }));
check(got.outcome === 'hold' && got.rule === 's01-hold-large-fare' && Boolean(got.approvalId), 'Dot (unattended) fare 2400 -> hold (s01-hold-large-fare)', JSON.stringify(got));
if (got.approvalId) {
  const own = await fetch(`${BASE}/api/approvals/${got.approvalId}/approve`, { method: 'POST', headers: { authorization: `Bearer ${dot}` } });
  check(own.status === 403, 'the requester cannot approve their own held call (403)', String(own.status));
  const ok = await fetch(`${BASE}/api/approvals/${got.approvalId}/approve`, { method: 'POST', headers: { authorization: `Bearer ${mint('priya')}` } }).then(async (r) => ({ status: r.status, body: await r.json() }));
  check(ok.status === 200 && ok.body.status === 'approved' && ok.body.outcome?.executed === true, 'Priya approves: the booking runs once', JSON.stringify({ status: ok.status, outcome: ok.body.outcome?.decision }));
}

console.log(`\n${total - failed}/${total} checks passed.`);
process.exit(failed ? 1 : 0);

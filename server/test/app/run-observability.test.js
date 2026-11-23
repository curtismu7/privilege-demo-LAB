import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApp, pfApp, startStubPf, signedIn, tmpDir, bearer, rpc } from './helpers.js';
import { assertRunObservability, classify, layerMatchers } from '../../src/runObservability.js';
import { MAX_RUNS, createRunLog, lineValue, replyOutcome, rowOf } from '../../src/runLog.js';
import { checkPin } from '../../../scripts/run-observability-checkPin.mjs';

// Rule 27 for this lab: the stdout line per decision, one run per record, the mode stored on the run, and the honesty of every row.
// Every test points STANDALONE_ENV at a file that does not exist (or a throwaway one): the owner's ~/Development/.env is never read.
const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const LINE = /^\d{4}-\d\d-\d\dT[\d:.]+Z privilege-demo-lab decision layer=[a-z]+ step=[a-z-]+ actor=\S+ agent=\S+ tool=\S+ result=(?:passed|stopped|unclear|no-reply) mode=(?:mock|live|real) run=\S+$/;
const WORDS = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served/i;
const PRODUCTS = [...new Set(layerMatchers.map((m) => m.product))];

let saved;
beforeEach(() => {
  saved = Object.fromEntries(Object.entries(process.env).filter(([k]) => k === 'STANDALONE_ENV' || k.startsWith('PDG_GW_')));
  for (const k of Object.keys(saved)) delete process.env[k];
  process.env.STANDALONE_ENV = '/nonexistent/none.env';
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) if (k === 'STANDALONE_ENV' || k.startsWith('PDG_GW_')) delete process.env[k];
  Object.assign(process.env, saved);
});

const make = (over = {}) => { const lines = []; return { ...mockApp(over, { log: (l) => lines.push(l) }), lines }; };
const call = (agent, body) => agent.post('/api/tools/call?envelope=1').send(body);
const fare = (amount) => ({ flightId: 'FL200', amount });
const recordOf = async (agent, runId) => (await agent.get(`/api/run-observability${runId ? `?runId=${runId}` : ''}`)).body;
const rows = (rec, layer) => rec.rows.filter((r) => r.layer === layer && r.origin !== 'not-logged');
const only = (rec, layer) => { const r = rows(rec, layer); expect(r, layer).toHaveLength(1); return r[0]; };
const clean = (rec) => expect(assertRunObservability(rec)).toEqual([]);

describe('the pin and the lab\'s safety', () => {
  it('every vendored run-observability file matches the pin, and the core is present', () => {
    expect(checkPin(root)).toEqual([]);
  });

  it('a vendored byte edited, or a file added without the pin, fails the pin check', () => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-pin-'));
    for (const f of ['server/src/runObservability.js', 'web/src/run-observability/RunObservability.jsx', 'web/src/run-observability/run-observability.css', 'web/src/run-observability/run-observability.test.jsx', 'web/src/run-observability/fixtures.js', 'web/src/run-observability/run-observability.sha256']) {
      fs.mkdirSync(path.dirname(path.join(copy, f)), { recursive: true });
      fs.copyFileSync(path.join(root, f), path.join(copy, f));
    }
    expect(checkPin(copy)).toEqual([]);
    const core = path.join(copy, 'server/src/runObservability.js');
    fs.appendFileSync(core, '\n// edited\n');
    expect(checkPin(copy).join()).toMatch(/runObservability\.js/);
    fs.copyFileSync(path.join(root, 'server/src/runObservability.js'), core);
    fs.writeFileSync(path.join(copy, 'web/src/run-observability/extra.js'), 'export {};\n');
    expect(checkPin(copy).join()).toMatch(/extra\.js/);
  });

  it('this lab reads no logs: no readers file, no file of the server names a reader or a RUN_OBS_ setting, and the core has no network or file access', () => {
    expect(fs.existsSync(path.join(root, 'server/src/runObservabilityReaders.js'))).toBe(false);
    const core = read('server/src/runObservability.js');
    expect(core).not.toMatch(/^\s*import\s/m);
    expect(core).not.toMatch(/ElasticsearchReader|DockerLogReader|readersFromEnv|\bfetch\s*\(|node:http|node:fs/);
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const f of walk(path.join(root, 'server/src')).filter((x) => /\.(js|mjs)$/.test(x) && !x.endsWith('runObservability.js'))) {
      expect(fs.readFileSync(f, 'utf8'), path.relative(root, f)).not.toMatch(/ElasticsearchReader|DockerLogReader|readersFromEnv|RUN_OBS_/);
    }
  });

  it('compose never mounts the Docker socket and no deployment file or example names a RUN_OBS_ setting', () => {
    for (const f of ['docker-compose.yml', 'docker-compose.shared-env.yml', 'Dockerfile', '.env.example']) {
      expect(read(f), f).not.toMatch(/docker\.sock|RUN_OBS_/);
    }
  });
});

describe('Mock: a tool call is one run, every row is a decision the lab computed', () => {
  it('no run yet: an honest answer, not an error and not another run', async () => {
    const mark = await signedIn(make(), 'mark');
    expect(await recordOf(mark)).toEqual({ record: null, message: expect.stringMatching(/No run has been made/), reason: 'no-run' });
    expect(await recordOf(mark, 'run-nope-1')).toMatchObject({ record: null, reason: 'unknown' });
  });

  it('the record is for signed-in people only', async () => {
    const ctx = make();
    expect((await request(ctx.app).get('/api/run-observability')).status).toBe(401);
  });

  it('a permitted call by an agent: sign-in is information, the agent is information, Cedar allows, the mock tool runs; all simulated', async () => {
    const ctx = make();
    const mark = await signedIn(ctx, 'mark');
    const r = await call(mark, { tool: 'book_fare', args: fare(500), asAgent: true });
    expect(r.body.outcome).toBe('allow');
    expect(r.body.runId).toMatch(/^run-[0-9a-f]{6}-\d+$/);
    const body = await recordOf(mark, r.body.runId);
    expect(body.run).toEqual({ id: r.body.runId, open: false, mode: 'mock' });
    const rec = body.record;
    clean(rec);
    expect(rec.source).toBe('mock');
    expect(rec.runId).toBe(r.body.runId);
    expect(rec.rows.every((x) => x.origin === 'simulated' || x.origin === 'not-logged')).toBe(true);
    expect(rec.coverage).toEqual({ person: 'simulated', agent: 'simulated', authorize: 'not-logged', privilege: 'simulated', gateway: 'not-logged', resource: 'simulated' });
    expect(rec.reasons.authorize).toMatch(/does not call PingOne Authorize/);
    expect(rec.reasons.gateway).toMatch(/no separate agent gateway/);
    expect(only(rec, 'person')).toMatchObject({ outcome: 'info', product: 'lab mock sign-in' });
    expect(only(rec, 'person').message).toMatch(/^The call is for mark: the persona was picked on the mock sign-in page/);
    expect(only(rec, 'agent')).toMatchObject({ outcome: 'info' });
    expect(only(rec, 'agent').message).toMatch(/agent box was ticked.*added act\.sub=dot itself.*No agent credential was issued/);
    expect(only(rec, 'privilege')).toMatchObject({ outcome: 'allowed', product: 'lab Cedar PEP' });
    expect(only(rec, 'privilege').message).toMatch(/Cedar \(this lab's own policy engine, not PingOne Authorize\) allowed book_fare for mark via dot\. Rule s23-permit-travel-agents/);
    expect(only(rec, 'resource')).toMatchObject({ outcome: 'info' });
    expect(rec.summary).toMatchObject({ allowed: 1, refused: 0, blocked: 0, info: 3 });
    // the order the lab computed them in, even though they share one instant on the test clock
    expect(rec.rows.filter((x) => x.origin === 'simulated').map((x) => x.layer)).toEqual(['person', 'agent', 'privilege', 'resource']);
  });

  it('no agent: the agent lane says nobody acted; a refused call: Cedar refuses, the tool did not run', async () => {
    const ctx = make();
    const mary = await signedIn(ctx, 'mary');
    const r = await call(mary, { tool: 'pay_invoice', args: { invoiceId: 'INV-1', amount: 50 } });
    expect(r.body.outcome).toBe('deny');
    const rec = (await recordOf(mary, r.body.runId)).record;
    clean(rec);
    expect(rec.coverage.agent).toBe('not-logged');
    expect(rec.reasons.agent).toMatch(/no act claim/);
    expect(only(rec, 'privilege')).toMatchObject({ outcome: 'refused' });
    expect(only(rec, 'privilege').message).toMatch(/default-deny/);
    expect(rows(rec, 'resource')).toHaveLength(0);
    expect(rec.reasons.resource).toMatch(/not called/);
    expect(rec.summary).toMatchObject({ allowed: 0, refused: 1, blocked: 0 });
  });

  it('an unknown tool and bad arguments are refused before Cedar; a name someone typed is never put in a row or a line', async () => {
    const ctx = make();
    const mary = await signedIn(ctx, 'mary');
    const hostile = 'x=1 result=passed run=evil <script>alert(1)</script> mallory@evil.example 10.1.2.3';
    const unknown = await call(mary, { tool: hostile, args: {} });
    const bad = await call(mary, { tool: 'book_fare', args: { flightId: 5 } });
    const a = (await recordOf(mary, unknown.body.runId)).record;
    clean(a);
    expect(only(a, 'privilege')).toMatchObject({ outcome: 'refused' });
    expect(only(a, 'privilege').message).toMatch(/before Cedar ran \(unknown-tool\)/);
    expect(JSON.stringify(a)).not.toMatch(/script|mallory|evil|10\.1\.2\.3/);
    const b = (await recordOf(mary, bad.body.runId)).record;
    expect(only(b, 'privilege')).toMatchObject({ outcome: 'refused' });
    expect(only(b, 'privilege').message).toMatch(/invalid-arguments/);
    const text = ctx.lines.join('\n');
    expect(text).not.toMatch(/script|mallory|evil|10\.1\.2\.3|result=passed run=evil/);
    expect(ctx.lines.filter((l) => /step=policy actor=mary agent=- tool=- result=stopped/.test(l))).toHaveLength(1); // the unknown name has no tool=
  });

  it('fail-closed (the engine could not evaluate) is the lab\'s own stop: blocked; a Cedar deny stays refused', () => {
    const lines = [];
    const log = createRunLog({ now: () => Date.UTC(2026, 10, 22, 10, 0, 0), write: (l) => lines.push(l) });
    const claims = { sub: 'mark', groups: ['travel-agents'] };
    const outcomes = {};
    for (const rule of ['error', 'invalid-claims', 'invalid-request', 'default-deny', 's23-forbid-over-cap', 'unknown-tool', 'invalid-arguments']) {
      const id = log.tool({ claims, source: 'session', tool: 'book_fare', out: { outcome: 'deny', rule, reason: 'x', rules: [] } });
      const run = log.find(id, 'mock').run;
      outcomes[rule] = run.facts.find((f) => f.layer === 'privilege').outcome;
    }
    expect(outcomes).toEqual({ error: 'blocked', 'invalid-claims': 'blocked', 'invalid-request': 'blocked', 'default-deny': 'refused', 's23-forbid-over-cap': 'refused', 'unknown-tool': 'refused', 'invalid-arguments': 'refused' });
  });

  it('a Bearer credential through /mcp: the sign-in check is an allowed decision of the lab\'s mock verifier; the run is the newest of this workspace', async () => {
    const ctx = make();
    const mark = await signedIn(ctx, 'mark');
    const token = (await mark.post('/api/mock/token').send({ asAgent: true })).body.access_token;
    const done = await rpc(request(ctx.app), token, 'tools/call', { name: 'search_flights', arguments: { query: 'SFO to JFK' } });
    expect(done.status).toBe(200);
    const rec = (await recordOf(mark)).record; // no runId: the newest run in this mode
    clean(rec);
    expect(only(rec, 'person')).toMatchObject({ outcome: 'allowed', product: 'lab mock issuer check' });
    expect(only(rec, 'person').message).toMatch(/accepted it: the call is for mark\./);
    expect(only(rec, 'agent').message).toMatch(/mock credential carries act\.sub=dot/);
  });

  it('a refused sign-in on a tool call begins no run, but the verifier\'s decision leaves its line', async () => {
    const ctx = make();
    const bad = await rpc(request(ctx.app), 'not-a-token', 'tools/call', { name: 'search_flights', arguments: { query: 'x' } });
    expect(bad.status).toBe(401);
    const mark = await signedIn(ctx, 'mark');
    expect(await recordOf(mark)).toMatchObject({ record: null, reason: 'no-run' });
    expect(ctx.lines).toHaveLength(1);
    expect(ctx.lines[0]).toMatch(LINE);
    expect(ctx.lines[0]).toMatch(/layer=person step=sign-in actor=- agent=- tool=- result=stopped mode=mock run=-$/);
    // a refused sign-in on tools/list is not a tool call: no line
    await rpc(request(ctx.app), 'not-a-token', 'tools/list', {});
    expect(ctx.lines).toHaveLength(1);
    // the console's own endpoint is a tool-call entry too
    expect((await request(ctx.app).post('/api/tools/call').send({ tool: 'search_flights', args: { query: 'x' } })).status).toBe(401);
    expect(ctx.lines).toHaveLength(2);
  });

  it('the envelope carries the run id, the plain call does not, and the trace response is exactly the answer', async () => {
    const ctx = make();
    const mary = await signedIn(ctx, 'mary');
    const plain = await mary.post('/api/tools/call').send({ tool: 'search_flights', args: { query: 'x' } });
    expect(plain.body.runId).toBeUndefined();
    const r = await call(mary, { tool: 'search_flights', args: { query: 'x' } });
    const { exchanges, ...shown } = r.body;
    expect(exchanges[0].trace.response.body).toEqual(shown);
    expect(shown.runId).toBeDefined();
  });
});

describe('a held call is one open run: the approver\'s answer is the decision', () => {
  const hold = async (ctx, mark) => (await call(mark, { tool: 'book_fare', args: fare(2400), asAgent: true })).body;

  it('hold = information (never counted as passed); the record stays open and never shows an answer that has not come', async () => {
    const ctx = make();
    const mark = await signedIn(ctx, 'mark');
    const h = await hold(ctx, mark);
    expect(h.outcome).toBe('hold');
    const body = await recordOf(mark, h.runId);
    expect(body.run.open).toBe(true);
    const p = only(body.record, 'privilege');
    expect(p).toMatchObject({ outcome: 'info' });
    expect(p.message).toMatch(/held book_fare for mark via dot\. Rule s01-hold-large-fare: Fares over 1000.*Waiting for priya: their answer will be the decision/);
    expect(rows(body.record, 'resource')).toHaveLength(0);
    expect(body.record.summary).toMatchObject({ allowed: 0, refused: 0, blocked: 0 });
    clean(body.record);
  });

  it('approved: the approver\'s answer is an allowed decision, the tool then runs, and the run closes', async () => {
    const ctx = make();
    const mark = await signedIn(ctx, 'mark');
    const priya = await signedIn(ctx, 'priya');
    const h = await hold(ctx, mark);
    ctx.clock.t += 30_000;
    const a = await priya.post(`/api/approvals/${h.approvalId}/approve`);
    expect(a.status).toBe(200);
    const body = await recordOf(mark, h.runId);
    expect(body.run.open).toBe(false);
    clean(body.record);
    const priv = rows(body.record, 'privilege');
    expect(priv.map((x) => x.outcome)).toEqual(['info', 'allowed']);
    expect(priv[1].message).toMatch(/priya approved the held call \(book_fare for mark via dot\)\. The lab re-checked it with one approval recorded.*and allowed it/);
    expect(Date.parse(priv[1].at) - Date.parse(priv[0].at)).toBe(30_000); // the time the approver answered, not invented spacing
    expect(only(body.record, 'resource')).toMatchObject({ outcome: 'info' });
    expect(body.record.rows.filter((x) => x.origin === 'simulated').map((x) => x.layer)).toEqual(['person', 'agent', 'privilege', 'privilege', 'resource']);
    // events after the verdict join nothing: a second answer is refused (409) and leaves no line for the run
    const before = ctx.lines.length;
    expect((await priya.post(`/api/approvals/${h.approvalId}/approve`)).status).toBe(409);
    expect(ctx.lines).toHaveLength(before);
    expect((await recordOf(mark, h.runId)).record.rows).toHaveLength(body.record.rows.length);
  });

  it('denied by the approver: refused, the tool never ran', async () => {
    const ctx = make();
    const mark = await signedIn(ctx, 'mark');
    const priya = await signedIn(ctx, 'priya');
    const h = await hold(ctx, mark);
    await priya.post(`/api/approvals/${h.approvalId}/deny`);
    const rec = (await recordOf(mark, h.runId)).record;
    clean(rec);
    expect(rows(rec, 'privilege').map((x) => x.outcome)).toEqual(['info', 'refused']);
    expect(rows(rec, 'privilege')[1].message).toMatch(/priya denied the held call \(book_fare for mark via dot\); it stays denied/);
    expect(rows(rec, 'resource')).toHaveLength(0);
  });

  it('expired (by the clock, and by the demo knob): the lab\'s own timeout stops it, `blocked`, and the run closes', async () => {
    const ctx = make({ approvalTtlMs: 60_000 });
    const mark = await signedIn(ctx, 'mark');
    const first = await hold(ctx, mark);
    ctx.clock.t += 61_000;
    await mark.get('/api/approvals'); // the lazy sweep notices the expiry now
    const a = await recordOf(mark, first.runId);
    expect(a.run.open).toBe(false);
    clean(a.record);
    expect(rows(a.record, 'privilege').map((x) => x.outcome)).toEqual(['info', 'blocked']);
    expect(rows(a.record, 'privilege')[1].message).toMatch(/Nobody answered the held call \(book_fare for mark via dot\) before it expired \(it was due 20/);
    const second = await call(mark, { tool: 'book_fare', args: fare(2500), asAgent: true });
    await mark.post(`/api/approvals/${second.body.approvalId}/expire`);
    const b = (await recordOf(mark, second.body.runId)).record;
    expect(rows(b, 'privilege').map((x) => x.outcome)).toEqual(['info', 'blocked']);
    expect(ctx.lines.filter((l) => /step=approval-timeout/.test(l))).toHaveLength(2);
  });

  it('a request that ran out of time while nobody looked at the queue is closed when its record is read', async () => {
    const ctx = make({ approvalTtlMs: 60_000 });
    const mark = await signedIn(ctx, 'mark');
    const h = await hold(ctx, mark);
    expect((await recordOf(mark, h.runId)).run.open).toBe(true);
    ctx.clock.t += 61_000;
    const body = await recordOf(mark, h.runId); // no approvals call in between
    expect(body.run.open).toBe(false);
    expect(rows(body.record, 'privilege').map((x) => x.outcome)).toEqual(['info', 'blocked']);
  });

  it('a held run is never evicted: 25 more calls push the oldest finished runs out, not the open one', async () => {
    const ctx = make();
    const mark = await signedIn(ctx, 'mark');
    const h = await hold(ctx, mark);
    const finished = [];
    for (let i = 0; i < MAX_RUNS + 5; i += 1) finished.push((await call(mark, { tool: 'search_flights', args: { query: `q${i}` } })).body.runId);
    expect((await recordOf(mark, h.runId)).run.open).toBe(true);
    expect(await recordOf(mark, finished[0])).toMatchObject({ record: null, reason: 'unknown' }); // evicted, and it says so
    expect((await recordOf(mark, finished.at(-1))).record.runId).toBe(finished.at(-1));
    expect(ctx.app.locals.workspaces.get('default').runs.count()).toBeLessThanOrEqual(MAX_RUNS);
  });

  it('events after the final verdict join nothing: a late answer or expiry for a closed run leaves a line with no run and no row', () => {
    const lines = [];
    const log = createRunLog({ now: () => Date.UTC(2026, 10, 22, 10, 0, 0), write: (l) => lines.push(l) });
    const claims = { sub: 'mark', groups: ['travel-agents'], act: { sub: 'dot' } };
    const id = log.tool({ claims, source: 'session', tool: 'book_fare', out: { outcome: 'hold', rule: 's01', reason: 'x', approvers: ['priya'], approvalId: 'ap-9', rules: [] } });
    const record = { id: 'ap-9', status: 'approved', tool: 'book_fare', claims, expiresAtMs: Date.UTC(2026, 10, 22, 10, 10, 0), outcome: { decision: 'allow', rule: 'r', reason: 'x', executed: true } };
    log.approval({ approver: 'priya', record });
    const run = log.find(id, 'mock').run;
    const kept = run.facts.length;
    expect(run.open).toBe(false);
    log.expired({ record: { ...record, outcome: { rule: 'approval-expired' } } });
    log.approval({ approver: 'priya', record });
    expect(run.facts).toHaveLength(kept);
    expect(lines.slice(-3).every((l) => /run=-$/.test(l))).toBe(true);
  });

  it('two identical held calls share one approval: the answer closes both runs, neither is left open', async () => {
    const ctx = make();
    const mark = await signedIn(ctx, 'mark');
    const priya = await signedIn(ctx, 'priya');
    const one = await hold(ctx, mark);
    const two = await hold(ctx, mark);
    expect(two.approvalId).toBe(one.approvalId);
    await priya.post(`/api/approvals/${one.approvalId}/approve`);
    for (const id of [one.runId, two.runId]) expect((await recordOf(mark, id)).run.open).toBe(false);
  });
});

describe('the mode is stored on the run and a run comes back only in its own mode', () => {
  it('Mock run, then Live: not returned as a Live record; back to Mock: returned; a Live run is a real record with every layer not logged', async () => {
    const pf = await startStubPf();
    try {
      const lines = [];
      const ctx = pfApp(pf, { mockSignin: true, host: '127.0.0.1' }, { log: (l) => lines.push(l) });
      const http = request(ctx.app);
      // Live: a Bearer token verified by the stub PingFederate's JWKS. The lab computes the decision itself, so nothing is shown as a row.
      const live = await http.post('/api/tools/call?envelope=1').set(bearer(await pf.mint({ sub: 'priya' }))).send({ tool: 'book_fare', args: fare(500) });
      expect(live.status).toBe(200);
      const liveBody = (await http.get(`/api/run-observability?runId=${live.body.runId}`).set(bearer(await pf.mint({ sub: 'priya' })))).body;
      expect(liveBody.run).toMatchObject({ mode: 'live', open: false });
      clean(liveBody.record);
      expect(liveBody.record.source).toBe('real');
      expect(liveBody.record.rows.every((x) => x.origin === 'not-logged')).toBe(true);
      expect(Object.values(liveBody.record.coverage)).toEqual(Array(6).fill('not-logged'));
      expect(liveBody.record.reasons.agent).toMatch(/UNVERIFIED/);
      expect(liveBody.record.reasons.privilege).toMatch(/lab computation, neither a log line nor a reply/);
      expect(lines.at(-1)).toMatch(/layer=resource step=tool-run actor=priya .* mode=live run=run-/); // the lab still writes its own line in Live
      // Mock: the Live run is not returned
      expect((await http.put('/api/mode').send({ mode: 'mock' })).body.mode).toBe('mock');
      const mark = request.agent(ctx.app);
      await mark.post('/api/auth/mock/login').send({ persona: 'mary' });
      expect(await recordOf(mark, live.body.runId)).toEqual({ record: null, message: 'That run was made in Live mode. Switch back to Live to see it.', reason: 'other-mode' });
      const mock = await call(mark, { tool: 'search_flights', args: { query: 'x' } });
      const mockBody = await recordOf(mark, mock.body.runId);
      expect(mockBody.run.mode).toBe('mock');
      expect(mockBody.record.source).toBe('mock');
      // and the Mock run is not returned in Live
      expect((await http.put('/api/mode').send({ mode: 'live' })).body.mode).toBe('live');
      const t = bearer(await pf.mint({ sub: 'priya' }));
      expect(await http.get(`/api/run-observability?runId=${mock.body.runId}`).set(t).then((r) => r.body)).toMatchObject({ record: null, reason: 'other-mode', message: expect.stringMatching(/Mock mode/) });
      // no runId: the newest run of the CURRENT mode, never of the other
      expect((await http.get('/api/run-observability').set(t)).body.run.id).toBe(live.body.runId);
    } finally { await pf.close(); }
  });
});

describe('the stdout line: one per decision, the row\'s own time, no word a shared matcher reads, no way to forge a second line', () => {
  it('one line per decision with the row\'s time; shape, mode and run id; no token', async () => {
    const ctx = make();
    const mark = await signedIn(ctx, 'mark');
    ctx.clock.t = Date.UTC(2026, 10, 22, 10, 0, 0, 250);
    const r = await call(mark, { tool: 'book_fare', args: fare(500), asAgent: true });
    const rec = (await recordOf(mark, r.body.runId)).record;
    const simulated = rec.rows.filter((x) => x.origin === 'simulated');
    expect(ctx.lines).toHaveLength(simulated.length);
    ctx.lines.forEach((l, i) => {
      expect(l).toMatch(LINE);
      expect(l.split(' ')[0]).toBe(simulated[i].at);
      expect(l).toContain(`run=${r.body.runId}`);
      expect(l).not.toMatch(WORDS);
    });
    expect(ctx.lines.map((l) => /layer=(\w+) step=([a-z-]+)/.exec(l).slice(1).join(':'))).toEqual(['person:sign-in', 'agent:agent', 'privilege:policy', 'resource:tool-run']);
    expect(ctx.lines[2]).toMatch(/actor=mark agent=dot tool=book_fare result=passed mode=mock/);
    expect(ctx.lines[0]).toMatch(/result=unclear/);
  });

  it('every kind of line, for every outcome and hostile values, is read by no shared matcher of any product', async () => {
    const lines = [];
    const log = createRunLog({ now: () => Date.UTC(2026, 10, 22, 10, 0, 0), write: (l) => lines.push(l) });
    const hostile = ['mark\nINFO: injected', 'a=b c=d', '"quoted"', 'mallory@evil.example', '10.1.2.3', 'Bearer abcdef0123456789abcdef0123', 'denied refused token scope', '<b>x</b>', 'x'.repeat(5000)];
    for (const sub of hostile) {
      for (const rule of ['default-deny', 'error', 'token-denied-by-me', 'forbidden.rule']) {
        for (const outcome of ['allow', 'deny', 'hold']) {
          const id = log.tool({ claims: { sub, act: { sub: `${sub}-agent` }, groups: [] }, source: 'bearer', tool: 'book_fare', out: { outcome, rule, reason: 'refused: token invalid', approvers: [sub], approvalId: outcome === 'hold' ? `ap-${lines.length}` : undefined } });
          expect(id).toMatch(/^run-/);
        }
      }
      log.approval({ approver: sub, record: { id: 'none', status: 'approved', tool: 'book_fare', claims: { sub, act: { sub } }, outcome: { decision: 'deny', rule: 'token', reason: 'denied', executed: false } } });
      log.expired({ record: { id: 'none', tool: 'book_fare', claims: { sub }, expiresAtMs: Date.UTC(2026, 10, 22, 10, 0, 0), outcome: { rule: 'approval-expired' } } });
      log.refusedSignIn({ reason: sub });
    }
    expect(lines.length).toBeGreaterThan(200);
    for (const line of lines) {
      expect(line).toMatch(LINE);
      expect(line.split('\n')).toHaveLength(1);
      expect(line.match(/ \w+=/g).length).toBe(8); // layer step actor agent tool result mode run: nothing was added
      const at = line.split(' ')[0];
      const body = line.slice(at.length + 1);
      for (const product of PRODUCTS) {
        expect(classify({ product, message: line, at: Date.parse(at), atExact: at }, []), `${product}: ${line.slice(0, 120)}`).toBeNull();
        expect(classify({ product, message: `[${at}] INFO: ${body}`, at: 0, atExact: '' }, []), `${product} behind a header`).toBeNull();
        expect(classify({ product, message: `[${at}] WARN: ${body}`, at: 0, atExact: '' }, []), `${product} behind a WARN header`).toBeNull();
      }
    }
    // the words a matcher reads are never the lab's own: only the typed values may carry them, and only after masking and sanitising
    const own = lines.map((l) => l.replace(/actor=\S+ agent=\S+ tool=\S+/, ''));
    for (const l of own) expect(l).not.toMatch(WORDS);
  });

  it('lineValue keeps a typed value from adding a key, a quote or a line; the line masks an email or an address typed as a name', async () => {
    expect(lineValue('mark result=passed\nrun=x "q"')).toBe('mark_result_passed_run_x_q_');
    expect(lineValue('')).toBe('-');
    const ctx = make();
    const mark = await signedIn(ctx, 'mark');
    await call(mark, { tool: 'search_flights', args: { query: 'x' } });
    ctx.lines.length = 0;
    const log = createRunLog({ write: (l) => ctx.lines.push(l) });
    log.tool({ claims: { sub: 'mallory@evil.example', act: { sub: '10.1.2.3' } }, source: 'session', tool: 'search_flights', out: { outcome: 'allow', rule: 'r', reason: 'x' } });
    expect(ctx.lines.join('\n')).not.toMatch(/mallory|evil\.example|10\.1\.2\.3/);
    expect(ctx.lines.every((l) => LINE.test(l))).toBe(true);
  });
});

describe('the recorder can never change a call, the audit or the page', () => {
  it('a throwing stdout writer: same answers, same audit rows, the run is still kept', async () => {
    const plain = make();
    const throwing = mockApp({}, { log: () => { throw new Error('stdout closed'); } });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = async (ctx) => {
      const mark = await signedIn(ctx, 'mark');
      const r = await call(mark, { tool: 'book_fare', args: fare(500), asAgent: true });
      const { runId, exchanges, ...rest } = r.body; // eslint-disable-line no-unused-vars
      return { rest, audit: ctx.app.locals.workspaces.get('default').audit.read().map(({ ts, trace_id, ...a }) => a), runId, mark };
    };
    const a = await run(plain); const b = await run(throwing);
    expect({ ...b.rest, traceparent: 0, trace_id: 0 }).toEqual({ ...a.rest, traceparent: 0, trace_id: 0 });
    expect(b.audit).toEqual(a.audit);
    expect((await recordOf(b.mark, b.runId)).record.rows.filter((x) => x.origin === 'simulated')).toHaveLength(4);
    expect(err).toHaveBeenCalled();
    expect(String(err.mock.calls[0][0])).toMatch(/stdout write failed \(Error\)/);
  });

  it('a recorder that throws on its own: the call still answers exactly as before, without a run id', async () => {
    const ctx = make();
    const mark = await signedIn(ctx, 'mark');
    const ws = ctx.app.locals.workspaces.get('default');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = await call(mark, { tool: 'search_flights', args: { query: 'x' } });
    const real = ws.runs.tool;
    // simulate a bug inside the recorder: a fact it cannot build
    ws.runs.tool = () => { try { throw new Error('boom'); } catch { return null; } };
    const r = await call(mark, { tool: 'search_flights', args: { query: 'x' } });
    ws.runs.tool = real;
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe(ok.body.outcome);
    expect(r.body.runId).toBeUndefined();
    expect(r.body.exchanges).toHaveLength(1);
    // and the real guard: a bad `out` never throws out of tool()
    const log = createRunLog({ write: () => {} });
    expect(log.tool({ claims: { sub: 'x' }, source: 'session', tool: 'search_flights', out: null })).toBeNull();
    expect(err).toHaveBeenCalled();
  });

  it('a record that cannot be built answers { error, message } JSON and logs the code to stderr', async () => {
    const ctx = make();
    const mark = await signedIn(ctx, 'mark');
    const r = await call(mark, { tool: 'search_flights', args: { query: 'x' } });
    const ws = ctx.app.locals.workspaces.get('default');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // a stored fact with a time the collector refuses
    ws.runs.find(r.body.runId, 'mock').run.facts[0].at = 'yesterday';
    const bad = await mark.get(`/api/run-observability?runId=${r.body.runId}`);
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: expect.stringMatching(/^bad_/), message: expect.any(String) });
    expect(String(err.mock.calls.at(-1)[0])).toMatch(/run record failed \(bad_/);
  });
});

describe('run ids are unique, and Reset clears the run list', () => {
  it('across Reset and across workspaces; an id from before a Reset is never another run', async () => {
    const ctx = make();
    const dana = await signedIn(ctx, 'dana');
    const a = await call(dana, { tool: 'search_flights', args: { query: 'x' } });
    expect((await dana.post('/api/reset').send({})).status).toBe(200);
    expect(await recordOf(dana, a.body.runId)).toMatchObject({ record: null, reason: 'unknown' });
    const b = await call(dana, { tool: 'search_flights', args: { query: 'x' } });
    const second = request.agent(ctx.app);
    await second.post('/api/auth/mock/login').set('x-workspace', 'second').send({ persona: 'mary' });
    const other = await second.post('/api/tools/call?envelope=1').set('x-workspace', 'second').send({ tool: 'search_flights', args: { query: 'x' } });
    expect(other.status).toBe(200);
    const ids = [a.body.runId, b.body.runId, other.body.runId];
    expect(new Set(ids).size).toBe(3);
    // the other workspace's run is not visible from this one
    expect(await recordOf(dana, other.body.runId)).toMatchObject({ record: null, reason: 'unknown' });
    expect((await second.get(`/api/run-observability?runId=${other.body.runId}`).set('x-workspace', 'second')).body.record.runId).toBe(other.body.runId);
  });
});

// ---- The Real gateway check: a fake door (a stub fetch), a throwaway settings file, nothing leaves the process ----
const KEY = `pdk-${randomBytes(12).toString('hex')}`;
const SESSION = `sess-${randomBytes(12).toString('hex')}`;
const door = () => {
  const file = path.join(tmpDir(), 'settings.env');
  fs.writeFileSync(file, `PDG_GW_URL=https://gateway.example/door\nPDG_GW_APPS=travel-door\nPDG_GW_KEY_TRAVEL_AGENT=${KEY}\n`);
  process.env.STANDALONE_ENV = file;
};
// onCall(method, params, id) -> { status, body } | 'drop' (the connection fails: no reply)
const stubGateway = (onCall) => vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
  if (init.method === 'DELETE') return new Response(null, { status: 200 });
  const msg = JSON.parse(init.body);
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  if (msg.method === 'initialize') return json(200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'stub-door', version: '1' }, capabilities: {} } }, { 'mcp-session-id': SESSION });
  if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 });
  const out = onCall(msg.method, msg.params, msg.id);
  if (out === 'drop') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  return json(out.status, out.body);
}));
const tools = (id) => ({ status: 200, body: { jsonrpc: '2.0', id, result: { tools: [{ name: 'search_flights', description: 'Search' }, { name: 'book_fare', description: 'Book' }] } } });
const check = (ctx) => request(ctx.app).post('/api/gateway-check').send({}).then((r) => ({ r }));
const gw = (rec) => rows(rec, 'gateway');

describe('the Real gateway check: each reply the lab received is a response row; a call with no reply has none', () => {
  it('a listing and a refused probe: allowed, and refused as a control; response rows, never logged; every other layer says why', async () => {
    door();
    stubGateway((method, params, id) => (method === 'tools/list' ? tools(id) : { status: 403, body: { error: 'forbidden', message: 'refused by policy' } }));
    const ctx = make();
    const { r } = await check(ctx);
    expect(r.status).toBe(200);
    const rec = r.body.observability;
    clean(rec);
    expect(rec.source).toBe('real');
    expect(rec.coverage).toEqual({ person: 'not-logged', agent: 'not-logged', authorize: 'not-logged', privilege: 'not-logged', gateway: 'response', resource: 'not-logged' });
    expect(rec.rows.filter((x) => x.origin === 'logged')).toHaveLength(0);
    expect(gw(rec).map((x) => [x.outcome, x.origin])).toEqual([['allowed', 'response'], ['refused', 'response']]);
    expect(gw(rec)[0].message).toMatch(/answered tools\/list with HTTP 200\. A usable reply listing 2 tools/);
    expect(gw(rec)[1].message).toMatch(/Control: the lab asked for a tool nothing grants, on purpose\. The gateway answered tools\/call with HTTP 403/);
    expect(gw(rec)[1].message).toMatch(/The lab reads HTTP 403 as: the caller's grant does not allow the call \(inferred from the status; the gateway did not say so\)\./);
    expect(gw(rec)[1].message).not.toMatch(/forbidden|refused by policy/); // the gateway's own words are not put in the lab's mouth
    expect(rec.summary).toMatchObject({ allowed: 1, refused: 1 });
    expect(r.body.noReply).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain(KEY);
    expect(JSON.stringify(r.body)).not.toContain(SESSION);
  });

  it('one stdout line per reply, the same time as its row, in mode real', async () => {
    door();
    stubGateway((method, params, id) => (method === 'tools/list' ? tools(id) : { status: 403, body: {} }));
    const ctx = make();
    ctx.clock.t = Date.UTC(2026, 10, 22, 10, 0, 0);
    const { r } = await check(ctx);
    const rec = r.body.observability;
    expect(ctx.lines).toHaveLength(2);
    ctx.lines.forEach((l, i) => { expect(l).toMatch(LINE); expect(l.split(' ')[0]).toBe(gw(rec)[i].at); expect(l).toContain(`run=${rec.runId}`); expect(l).toMatch(/layer=gateway .* mode=real/); });
    expect(ctx.lines.map((l) => /step=(\S+) .* result=(\S+)/.exec(l).slice(1).join(':'))).toEqual(['gateway-list:passed', 'gateway-probe:stopped']);
    for (const l of ctx.lines) for (const product of PRODUCTS) expect(classify({ product, message: l, at: Date.parse(l.split(' ')[0]), atExact: l.split(' ')[0] }, [])).toBeNull();
  });

  it('401 at the handshake is a refusal of the lab\'s key (no probe is made); a JSON-RPC error and isError are refused; an unusable 200 and a 5xx are information', async () => {
    door();
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => (init.method === 'DELETE' ? new Response(null, { status: 200 }) : new Response('{"error":"x"}', { status: 401, headers: { 'content-type': 'application/json' } }))));
    const a = (await check(make())).r.body;
    clean(a.observability);
    expect(gw(a.observability).map((x) => x.outcome)).toEqual(['refused']);
    expect(gw(a.observability)[0].message).toMatch(/answered initialize \(the call stopped there; tools\/list was never sent\) with HTTP 401\. The lab reads HTTP 401 as: the gateway did not accept the agent key \(inferred/);
    expect(a.refusal).toBeUndefined();

    stubGateway((method, params, id) => (method === 'tools/list' ? tools(id) : { status: 200, body: { jsonrpc: '2.0', id, error: { code: -32001, message: 'not granted' } } }));
    const rpcErr = gw((await check(make())).r.body.observability);
    expect(rpcErr.map((x) => x.outcome)).toEqual(['allowed', 'refused']);
    expect(rpcErr[1].message).toMatch(/the gateway returned a JSON-RPC error: not granted.*\(read from the reply\)/); // observed: quoted, and said to be read from the reply

    stubGateway((method, params, id) => (method === 'tools/list' ? tools(id) : { status: 200, body: { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: 'no such tool' }] } } }));
    expect(gw((await check(make())).r.body.observability).map((x) => x.outcome)).toEqual(['allowed', 'refused']);

    stubGateway((method, params, id) => (method === 'tools/list' ? tools(id) : { status: 200, body: { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'ran' }] } } }));
    const unexpected = gw((await check(make())).r.body.observability);
    expect(unexpected.map((x) => x.outcome)).toEqual(['allowed', 'allowed']);
    expect(unexpected[1].message).toMatch(/The lab did not expect that/);

    stubGateway((method, params, id) => (method === 'tools/list' ? { status: 200, body: { jsonrpc: '2.0', id } } : { status: 503, body: { error: 'server_error' } }));
    const odd = gw((await check(make())).r.body.observability);
    expect(odd.map((x) => x.outcome)).toEqual(['info', 'info']); // an empty answer and a 5xx are not decisions of the gateway
  });

  it('a call that got no reply has no row: the lane says why, the page gets a note, the line says no-reply, and a status from the earlier call is never reused', async () => {
    door();
    stubGateway((method, params, id) => (method === 'tools/list' ? tools(id) : 'drop'));
    const ctx = make();
    const { r } = await check(ctx);
    const rec = r.body.observability;
    clean(rec);
    expect(gw(rec).map((x) => x.message.match(/answered (\S+)/)[1])).toEqual(['tools/list']); // only the call that was answered
    expect(r.body.noReply).toHaveLength(1);
    expect(r.body.noReply[0]).toMatch(/^tools\/call \(.*unreachable/);
    expect(ctx.lines.map((l) => /result=(\S+)/.exec(l)[1])).toEqual(['passed', 'no-reply']);

    stubGateway(() => 'drop');
    const all = (await check(make())).r.body;
    clean(all.observability);
    expect(gw(all.observability)).toHaveLength(0);
    expect(all.observability.coverage.gateway).toBe('not-logged');
    expect(all.observability.reasons.gateway).toMatch(/No reply came back, so nothing is claimed for it: tools\/list \(/);
  });

  it('the gateway\'s own words are masked and inert in the record; a key echoed in a reply never reaches it', async () => {
    door();
    stubGateway((method, params, id) => (method === 'tools/list'
      ? { status: 200, body: { jsonrpc: '2.0', id, result: { tools: [], echo: `your key ${KEY}` } } }
      : { status: 403, body: { message: `denied for mallory@evil.example from 10.1.2.3 Bearer abcdef0123456789abcdef0123 <script>x</script> ${KEY}` } }));
    const { r } = await check(make());
    const rec = r.body.observability;
    clean(rec);
    const text = JSON.stringify(r.body.observability);
    for (const bad of [KEY, KEY.slice(0, 10), 'mallory@evil.example', '10.1.2.3', 'abcdef0123456789abcdef0123']) expect(text).not.toContain(bad);
  });

  it('a recorder failure on the check never breaks it: the answer still has the exchanges, and the page gets an { error, message } record', async () => {
    door();
    stubGateway((method, params, id) => (method === 'tools/list' ? tools(id) : { status: 403, body: {} }));
    const ctx = make();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ws = ctx.app.locals.workspaces.get('default');
    const real = ws.runs.gatewayCheck;
    ws.runs.gatewayCheck = () => real({ startedAt: 'yesterday', caller: 'x', replies: [] }); // makes the collector refuse the window
    const { r } = await check(ctx);
    expect(r.status).toBe(200);
    expect(r.body.exchanges).toHaveLength(2);
    expect(r.body.observability).toEqual({ error: expect.stringMatching(/^bad_/), message: expect.any(String) });
    expect(String(err.mock.calls.at(-1)[0])).toMatch(/run log: gateway record failed/);
  });

  it('not configured: the check is refused as before and no record is invented', async () => {
    const r = await request(make().app).post('/api/gateway-check').send({});
    expect(r.status).toBe(409);
    expect(r.body.observability).toBeUndefined();
  });
});

describe('rows and outcomes', () => {
  it('only a decision of a policy point is allowed or refused: replyOutcome reads the lab\'s own marks, an info decision is never a pass', () => {
    const t = (...d) => ({ decisions: d.map(([outcome]) => ({ outcome })) });
    expect(replyOutcome(t(['pass'], ['pass']))).toBe('allowed');
    expect(replyOutcome(t(['pass'], ['fail']))).toBe('refused');
    expect(replyOutcome(t(['pass'], ['info']))).toBe('info');
    expect(replyOutcome(t(['fail'], ['skipped']))).toBe('refused');
    expect(replyOutcome({})).toBe('allowed');
  });

  it('rowOf refuses a fact it does not know', () => {
    expect(() => rowOf({ kind: 'invented' })).toThrow();
  });
});

describe('the process writes the stdout lines (spawned, the real index.js)', () => {
  it('one line per decision reaches stdout, with the shape and the run id the page was given', async () => {
    const port = 4760 + Math.floor(Math.random() * 9);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-obs-'));
    const entry = fileURLToPath(new URL('../../src/index.js', import.meta.url));
    const child = spawn(process.execPath, [entry], { env: { PATH: process.env.PATH, STANDALONE_ENV: '/nonexistent/none.env', DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', ALLOW_MOCK_SIGNIN: '1', DEMO_MODE: 'mock' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    try {
      for (let i = 0; i < 100 && !/listening on/.test(out); i += 1) await new Promise((r) => setTimeout(r, 100));
      expect(out).toMatch(/listening on/);
      const base = `http://127.0.0.1:${port}`;
      const login = await fetch(`${base}/api/auth/mock/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ persona: 'mary' }) });
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const call = await fetch(`${base}/api/tools/call?envelope=1`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ tool: 'search_flights', args: { query: 'x' } }) });
      const { runId } = await call.json();
      await new Promise((r) => setTimeout(r, 200));
      const lines = out.split('\n').filter((l) => l.includes('privilege-demo-lab decision'));
      expect(lines.map((l) => /layer=(\w+) step=([a-z-]+)/.exec(l).slice(1).join(':'))).toEqual(['person:sign-in', 'privilege:policy', 'resource:tool-run']);
      for (const l of lines) { expect(l).toMatch(LINE); expect(l).toContain(`run=${runId}`); }
    } finally { child.kill(); }
  }, 30_000);
});

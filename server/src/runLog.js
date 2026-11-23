// Rule 27: this lab's half of the shared run-observability panel. The vendored collector (runObservability.js) is never edited here.
//
// A "run" is one tool call (the Tool console or POST /mcp) from its sign-in check to its final verdict. A held call keeps its run OPEN
// until the approver answers or the request expires, so one record covers the hold and the answer. Every decision the lab computes is
// stamped ONCE here, written as ONE stdout line, and kept as a stored fact of its run; the record is built from those stored facts only:
// nothing is re-run, no time is invented, and nothing is shown that the lab did not compute. Time = when the lab recorded the decision.
//
// What each source is, honestly:
//   - Mock (the in-process mock issuer, this lab's own Cedar PEP, mock tool backends): rows are `simulated`.
//   - Live (PingFederate verifies the tokens, the lab's own Cedar PEP decides, tool backends stay mocks): the lab reads no product log and
//     no decision here is a reply from a product, so there is no row to show: every layer is `not-logged` and says why. `simulated` exists
//     only in a Mock record, and `response` only for a reply the lab really received.
//   - The Real gateway check (POST /api/gateway-check): each reply the lab received from the Privilege door is a `response` row. A call that
//     got no reply has no row (the page says so). The lab reads no gateway log, so nothing is ever `logged`.
//
// Stdout line (what a collector would ship): `<iso> privilege-demo-lab decision layer=<layer> step=<step> actor=<who> agent=<agent|-> act-source=<lab|credential|-> tool=<tool|-> result=<passed|stopped|unclear|no-reply> mode=<mock|live|real> cause=<code|-> count=<n> run=<id|->`.
// act-source says who added the agent: `lab` (the console's agent box) or `credential` (the credential or session carried act). cause is a fixed code
// for a refused sign-in. A burst of refused sign-ins from one cause is one line (count=1), then one line with the number that were not written.
// The family's matchers read words such as refused, denied, rejected, forbidden, failed, invalid, expired, mismatch, token, audience, scope
// and served, so the line uses none of them (steps and results come from the tables below). A test runs every line through the shared classify().
import crypto from 'node:crypto';
import { createMasker, createRunObservability, keepPattern } from './runObservability.js';

const SERVICE = 'privilege-demo-lab';
export const MAX_RUNS = 20; // per workspace: the newest finished runs, plus every run still open (a held call is never evicted)

// Only safe characters survive, so a sub, tool or rule typed by someone cannot add a second key=value pair, a quote or a line.
export const lineValue = (v, n = 64) => String(v ?? '').replace(/[^A-Za-z0-9._:/@-]+/g, '_').slice(0, n) || '-';
// The panel masks emails, addresses and ids in every row, so the stdout line masks them too (then keeps only safe characters).
const { mask } = createMasker();
const KEEP = keepPattern({});
const field = (v) => lineValue(mask(String(v ?? ''), KEEP));
const RESULT = { allowed: 'passed', refused: 'stopped', blocked: 'stopped', info: 'unclear' };
const text = (v, n = 160) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, n);

const subOf = (c) => (typeof c?.sub === 'string' && c.sub ? c.sub : null);
const actOf = (c) => (typeof c?.act?.sub === 'string' && c.act.sub ? c.act.sub : null);

// The PEP's answer -> the outcome of its row. Cedar's allow and deny are decisions of a policy point. A hold is not a decision yet (the
// approver's answer will be): `info`. Where the lab could not evaluate the request at all, decide() fails closed: that is the lab's own
// security control stopping the call, not a policy verdict, so it is `blocked`. An unknown tool or bad arguments are ordinary checks: `refused`.
const FAIL_CLOSED = new Set(['error', 'invalid-claims', 'invalid-request']);
const BEFORE_CEDAR = new Set(['unknown-tool', 'invalid-arguments']);
const pepOutcome = (out) => (out.outcome === 'allow' ? 'allowed' : out.outcome === 'hold' ? 'info' : FAIL_CLOSED.has(out.rule) ? 'blocked' : 'refused');

// Why the sign-in check refused a call: the verifier's reasons, in a fixed vocabulary of our own. The reasons themselves hold words the shared
// matchers read (expired, audience, token ...), so they never reach a line; anything not in the table is `other`.
export const SIGN_IN_CAUSES = {
  no_credentials: 'no-credential', no_bearer: 'no-credential', bearer_not_enabled: 'not-configured', pf_not_configured: 'not-configured',
  expired: 'out-of-time', not_yet_valid: 'out-of-time', wrong_issuer: 'not-for-us', wrong_audience: 'not-for-us',
  alg_not_allowed: 'unreadable', malformed: 'unreadable', unverifiable: 'unreadable', bad_signature: 'bad-signature',
  groups_missing: 'missing-claims', claims_invalid: 'missing-claims', pf_unreachable: 'pf-unreachable', pf_introspection_failed: 'pf-unreachable', token_inactive: 'inactive',
};
const causeOf = (reason) => (typeof reason === 'string' && Object.hasOwn(SIGN_IN_CAUSES, reason) ? SIGN_IN_CAUSES[reason] : 'other');
const REFUSAL_WINDOW_MS = 10_000;

// ---- A stored fact -> the row of the panel (Mock only) -----------------------------------------------------------------------------
// who may read a held run whole: the person who asked, a named approver, an approver who answered, an admin (the same people /api/approvals
// shows the request to). Anyone else gets the same rows with the people left out: `hidden` swaps every name for a plain noun.
const HIDDEN = { who: 'another person', agent: 'an agent', approver: 'an approver', approvers: ['an approver'] };
const forCall = (f) => `${f.tool ? `${f.tool} for ${f.who}` : `the call for ${f.who}`}${f.agent ? ` via ${f.agent}` : ''}`;
const CEDAR = 'Cedar (this lab\'s own policy engine, not PingOne Authorize)';
// The row of a stored fact: its product, its words and its detail. The layer and the outcome are the fact's own (the line says the same).
export function rowOf(fact, hidden = false) {
  const f = hidden ? { ...fact, who: HIDDEN.who, agent: fact.agent ? HIDDEN.agent : fact.agent, approver: HIDDEN.approver, approvers: HIDDEN.approvers } : fact;
  const act = hidden ? 'an act claim' : `act.sub=${f.agent}`;
  switch (f.kind) {
    case 'session':
      return { product: 'lab mock sign-in', message: `The call is for ${f.who}: the persona was picked on the mock sign-in page and the lab read it from its signed cookie. A sign-in, not a decision.` };
    case 'live-session':
      return { product: 'lab session cookie', message: `The call is for ${f.who}: the lab read the person from a signed session cookie made at a live sign-in. A sign-in, not a decision.` };
    case 'bearer':
      return { product: 'lab mock issuer check', message: `The lab checked the mock Bearer credential against its in-process mock issuer and accepted it: the call is for ${f.who}. Authentication, not a policy decision.` };
    case 'agent-flag':
      return { product: 'lab mock console', message: `The Tool console's agent box was ticked, so the lab added ${act} itself: ${f.agent} makes the call for ${f.who}, unattended. No agent credential was issued.` };
    case 'agent-claim':
      return { product: 'lab mock issuer check', message: `The mock credential carries ${act}: ${f.agent} makes the call for ${f.who}, unattended.` };
    case 'agent-session':
      return { product: 'lab session cookie', message: `The session's claims carry ${act}: ${f.agent} makes the call for ${f.who}, unattended.` };
    case 'before-cedar':
      return { product: 'lab Cedar PEP', message: `The PEP refused the call before Cedar ran (${f.rule}): ${text(f.reason)}.`, detail: { rule: f.rule } };
    case 'cedar':
      if (f.outcome === 'blocked') return { product: 'lab Cedar PEP', message: `The PEP stopped ${forCall(f)}: it fails closed when a request cannot be evaluated. Rule ${f.rule}: ${text(f.reason)}.`, detail: { rule: f.rule } };
      return { product: 'lab Cedar PEP', message: `${CEDAR} ${f.outcome === 'allowed' ? 'allowed' : f.outcome === 'info' ? 'held' : 'refused'} ${forCall(f)}. Rule ${f.rule}: ${text(f.reason)}.${f.outcome === 'info' ? ` Waiting for ${text((f.approvers || []).join(', ') || 'an approver', 100)}: their answer will be the decision.` : ''}`, detail: { rule: f.rule } };
    case 'tool-run':
      return { product: 'lab mock tool backend', message: `The lab's mock tool backend ran ${f.tool} and returned a made-up result. No backend verified anything: the PEP had already allowed the call.` };
    case 'approver':
      return { product: 'lab Cedar PEP', message: !f.approved
        ? `${f.approver} denied the held call (${forCall(f)}); it stays denied.`
        : f.outcome === 'allowed'
          ? `${f.approver} approved the held call (${forCall(f)}). The lab re-checked it with one approval recorded (rule ${f.rule}) and allowed it.`
          : `${f.approver} approved the held call (${forCall(f)}), but the lab's re-check against the current policies refused it. Rule ${f.rule}: ${text(f.reason)}.`, detail: { rule: f.rule } };
    case 'timeout':
      return { product: 'lab Cedar PEP', message: `Nobody answered the held call (${forCall(f)}) before it expired (it was due ${f.dueAt}), so the lab keeps it denied (rule ${f.rule}). The lab noticed when it next looked at the queue.`, detail: { rule: f.rule, dueAt: f.dueAt } };
    default:
      throw new Error('unknown fact');
  }
}

// ---- The lanes that have no row, and why --------------------------------------------------------------------------------------------
const NO_AUTHORIZE = 'This lab does not call PingOne Authorize. Its policy engine is Cedar, running inside the lab; that decision is shown under Privilege.';
const MOCK_WHY = {
  agent: 'No agent acted on this run: the call carries no act claim, so the person made it themselves.',
  authorize: NO_AUTHORIZE,
  gateway: 'This lab has no separate agent gateway: its own PEP (the Privilege lane) takes the gateway\'s place. A real Privilege door is called only by the Privilege gateway check, which has its own record.',
  resource: 'The mock tool backend was not called on this run: the call was refused or is held for an approver.',
};
const LIVE_WHY = {
  person: 'Live mode: this lab checks the sign-in or Bearer credential itself, against your PingFederate. PingFederate\'s audit.log is not shipped and this lab reads no product log, so no sign-in line is shown. The lab\'s own check is on the Trace page and in its stdout line.',
  agent: 'The act claim, if any, is read by the lab from the credential. Whether a real PingFederate puts an object-valued act in its access tokens is UNVERIFIED, so it is not shown here as a fact.',
  authorize: NO_AUTHORIZE,
  privilege: 'The decision on this run was made by this lab\'s own Cedar PEP, not by Privilege: a lab computation, neither a log line nor a reply from a product. It is on the Tool console result and the Trace page. This panel shows only what a product logged or replied.',
  gateway: 'This lab has no separate agent gateway on this path. A real Privilege door is called only by the Privilege gateway check, which has its own record.',
  resource: 'Tool backends are mocks in Live mode too: none logged anything.',
};
const REAL_WHY = {
  person: 'No person is involved in the gateway check: the lab presents an agent access key. The key is never shown.',
  agent: 'The gateway\'s log line that names the agent is not read: this lab reads no product log.',
  authorize: NO_AUTHORIZE,
  privilege: 'Privilege\'s policy decision is inside the gateway\'s reply, shown under Agent gateway. Its SIEM events are not read here.',
  resource: 'The check lists tools and asks for one nothing grants; no tool of the backend ran.',
};

// ---- A reply the lab received from the Privilege door -> its row (the Real gateway check) ----------------------------------------------
// trace: traceFromDoor's answer for the exchange. Its decisions already carry the lab's reading of the status, marked inferred (read from
// the outcome) or observed (read from the reply); the row says which, and never presents an inferred reading as the gateway's own words.
const INFERRED = { authenticated: 'the gateway did not accept the agent key', grant: 'the caller\'s grant does not allow the call' };
const decisionsOf = (trace) => (Array.isArray(trace?.decisions) ? trace.decisions : []);
// A 200 whose result is null or empty says nothing the lab can read a grant from: like an unparsed body, it is information.
const emptyResult = (trace) => {
  const r = trace?.response;
  if (r?.status !== 200 || !r.body || typeof r.body !== 'object' || !('result' in r.body)) return false;
  return r.body.result === null || (typeof r.body.result === 'object' && Object.keys(r.body.result).length === 0);
};
export function replyOutcome(trace) {
  const d = decisionsOf(trace);
  return d.some((x) => x.outcome === 'fail') ? 'refused' : d.some((x) => x.outcome === 'info') || emptyResult(trace) ? 'info' : 'allowed';
}
function replyRow({ asked, control, trace, at }) {
  const status = trace.response.status;
  const sent = text(trace.request?.body?.method || asked, 40);
  const outcome = replyOutcome(trace);
  const d = decisionsOf(trace);
  const why = d.find((x) => x.outcome === 'fail') || d.find((x) => x.outcome === 'info');
  const tools = Array.isArray(trace.response.body?.result?.tools) ? trace.response.body.result.tools.length : null;
  // An inferred decision is the lab's reading of the status, so it is worded as the lab's and quotes nothing (the evidence of a 403 can hold the
  // gateway's own words); an observed one was read from the reply, so its evidence is quoted.
  const reading = emptyResult(trace) ? 'The reply holds an empty result, so the lab cannot read a grant from it.'
    : outcome === 'allowed'
    ? `A usable reply${tools === null ? '' : ` listing ${tools} tool${tools === 1 ? '' : 's'}`}.`
    : !why ? ''
      : why.basis === 'inferred' ? `The lab reads HTTP ${status} as: ${INFERRED[why.id] || text(why.label, 60).toLowerCase()} (inferred from the status; the gateway did not say so).`
        : `${text(why.label, 60)}: ${text(why.evidence, 200)} (read from the reply).`;
  const lead = `${control ? 'Control: the lab asked for a tool nothing grants, on purpose. ' : ''}The gateway answered ${sent}${sent === asked ? '' : ` (the call stopped there; ${asked} was never sent)`} with HTTP ${status}. ${reading}${control && outcome === 'allowed' ? ' The lab did not expect that.' : ''}`;
  return { at, layer: 'gateway', product: 'Privilege gateway reply', outcome, message: lead.trim(), detail: { call: sent, status, ...(control ? { control: true } : {}) } };
}

// ---- The run log of ONE workspace ---------------------------------------------------------------------------------------------------
// now(): the lab's clock in epoch ms. write(line): one stdout line. mode(): 'mock' | 'live' (the lab's mode when a run begins; stored on the run).
// scope: the workspace id. Run ids are unique per workspace by a counter that survives Reset, across workspaces by the workspace id, and across
// restarts of the process by random bits (probabilistic): an id from before a Reset is never another run.
// refusalWindowMs: refused sign-ins of one cause inside this window are counted, not written one by one.
export function createRunLog({ now = Date.now, write = () => {}, mode = () => 'mock', scope = 'default', refusalWindowMs = REFUSAL_WINDOW_MS } = {}) {
  const part = crypto.randomBytes(3).toString('hex');
  let made = 0;
  let runs = []; // oldest first: { id, mode, requester, approvers, held, actSource, startedAt, endedAt, open, facts: [{ at, layer, step, outcome, kind, ... }] }
  let byApproval = new Map(); // approval id -> the open runs waiting for it
  let refusal = null; // the cause being counted: { cause, since, suppressed }
  let timer = null;
  const iso = () => new Date(now()).toISOString();
  const nextId = () => { made += 1; return `run-${scope}-${part}-${made}`; };
  const fail = (what, e) => console.error(`[privilege-demo] run log: ${what} failed (${e?.name || 'error'})`);
  const guard = (what, fn, fallback) => (...a) => { try { return fn(...a); } catch (e) { fail(what, e); return fallback; } };
  const currentMode = () => (mode() === 'live' ? 'live' : 'mock');

  const begin = () => {
    const at = iso();
    const run = { id: nextId(), mode: currentMode(), requester: null, approvers: new Set(), held: false, actSource: '-', startedAt: at, endedAt: at, open: false, facts: [] };
    runs.push(run);
    // The newest finished runs of each mode are kept; a run that is still open (a held call) is never evicted, and one mode never pushes out the other.
    while (runs.filter((r) => r.mode === run.mode).length > MAX_RUNS) {
      const old = runs.findIndex((r) => r.mode === run.mode && !r.open);
      if (old < 0 || runs[old] === run) break;
      runs.splice(old, 1);
    }
    return run;
  };

  // One decision: stamped once, written as one line, kept as a fact of its run (or on stdout only when it belongs to no run).
  function note(run, f) {
    const at = iso();
    const fact = { ...f, at };
    const m = run?.mode ?? currentMode();
    try {
      write(`${at} ${SERVICE} decision layer=${f.layer} step=${f.step} actor=${field(f.actor)} agent=${field(f.agent)} act-source=${f.actSource ?? run?.actSource ?? '-'} tool=${f.tool ? field(f.tool) : '-'} result=${f.result || RESULT[f.outcome]} mode=${m} cause=${f.cause ?? '-'} count=${f.count ?? 1} run=${run ? lineValue(run.id) : '-'}`);
    } catch (e) { fail('stdout write', e); }
    if (run) { run.facts.push(fact); run.endedAt = at; }
  }

  // A tool call reached the PEP. claims: what enforce() was given; viaFlag: the console's agent box (the lab added act itself);
  // persona: the mock persona the session names (none for a Bearer credential or a live sign-in cookie).
  const tool = guard('tool call', ({ claims, source, persona, viaFlag = false, tool: name, out }) => {
    const run = begin();
    const who = subOf(claims);
    const agent = actOf(claims);
    const known = out.rule !== 'unknown-tool' ? name : null; // an unknown name is typed by the caller: it is never put in a row or a line
    run.requester = who;
    run.actSource = agent ? (viaFlag ? 'lab' : 'credential') : '-';
    const person = source === 'bearer' ? 'bearer' : persona ? 'session' : 'live-session';
    // Checking who the call is for is authentication, not a policy decision: information, whichever way the person was named.
    note(run, { layer: 'person', step: 'sign-in', outcome: 'info', kind: person, actor: who, agent, who });
    if (agent) note(run, { layer: 'agent', step: 'agent', outcome: 'info', kind: viaFlag ? 'agent-flag' : person === 'bearer' ? 'agent-claim' : 'agent-session', actor: who, agent, who });
    note(run, { layer: 'privilege', step: 'policy', outcome: pepOutcome(out), kind: BEFORE_CEDAR.has(out.rule) ? 'before-cedar' : 'cedar', actor: who, agent, tool: known, who, rule: text(out.rule, 100), reason: out.reason, approvers: out.approvers });
    if (out.outcome === 'allow') note(run, { layer: 'resource', step: 'tool-run', outcome: 'info', kind: 'tool-run', actor: who, agent, tool: known });
    if (out.outcome === 'hold' && out.approvalId) {
      run.open = true;
      run.held = true;
      for (const a of Array.isArray(out.approvers) ? out.approvers : []) run.approvers.add(a);
      byApproval.set(out.approvalId, [...(byApproval.get(out.approvalId) || []), run]);
    }
    return run.id;
  }, null);

  // The approver answered (record = the approval after pep.resolve()).
  const approval = guard('approver answer', ({ approver, record }) => {
    const waiting = byApproval.get(record.id) || [null]; // null: the run is gone (Reset); the decision still gets its line
    const who = subOf(record.claims);
    const agent = actOf(record.claims);
    const approved = record.status === 'approved';
    const out = record.outcome || {};
    for (const run of waiting) {
      note(run, { layer: 'privilege', step: 'approver-answer', outcome: approved && out.decision === 'allow' ? 'allowed' : 'refused', kind: 'approver', actor: approver, agent, tool: record.tool, who, approver, approved, rule: text(out.rule, 100), reason: out.reason });
      if (out.executed) note(run, { layer: 'resource', step: 'tool-run', outcome: 'info', kind: 'tool-run', actor: who, agent, tool: record.tool });
      if (run) { run.open = false; run.approvers.add(approver); }
    }
    byApproval.delete(record.id);
  }, undefined);

  // The request expired with no answer (the lab's own timeout keeps the call denied).
  const expired = guard('approval timeout', ({ record }) => {
    const waiting = byApproval.get(record.id) || [null];
    for (const run of waiting) {
      note(run, { layer: 'privilege', step: 'approval-timeout', outcome: 'blocked', kind: 'timeout', actor: '-', agent: actOf(record.claims), tool: record.tool, who: subOf(record.claims), rule: text(record.outcome?.rule || 'approval-expired', 100), dueAt: new Date(record.expiresAtMs).toISOString() });
      if (run) run.open = false;
    }
    byApproval.delete(record.id);
  }, undefined);

  // The sign-in check refused a tool call before it began a run: a decision of the verifier, so it leaves a line (with a fixed cause code), but there
  // is no record. Refusals of one cause inside the window are counted: the first is written, the rest are written as one line with their number when
  // the window ends (by the next refusal, or by the window's own timer).
  const refusalLine = (cause, count) => note(null, { layer: 'person', step: 'sign-in', outcome: 'refused', actor: '-', agent: '-', actSource: '-', tool: null, cause, count });
  const flushRefusals = guard('refusal count', () => {
    if (refusal?.suppressed > 0) { refusalLine(refusal.cause, refusal.suppressed); refusal.suppressed = 0; }
  }, undefined);
  const refusedSignIn = guard('sign-in refusal', ({ reason }) => {
    const cause = causeOf(reason);
    if (refusal && refusal.cause === cause && now() - refusal.since < refusalWindowMs) { refusal.suppressed += 1; return; }
    flushRefusals();
    clearTimeout(timer);
    refusalLine(cause, 1);
    refusal = { cause, since: now(), suppressed: 0 };
    timer = setTimeout(flushRefusals, refusalWindowMs);
    timer.unref?.(); // a count still waiting never keeps the process alive
  }, undefined);

  // The newest run of `wanted` mode, or the run with that id. viewer ({ sub, admin }) is who asks; no viewer means the lab itself (everything).
  // With an id, anyone may ask; a held run is returned with `redact: true` for someone who did not take part. Without an id, only a run the viewer
  // took part in is "the newest": nobody is handed another person's run by default.
  // -> { run, redact } | { none: 'no-run' | 'unknown' | 'other-mode', runMode }
  const mayRead = (run, viewer) => !viewer || viewer.admin === true || run.requester === viewer.sub || run.approvers.has(viewer.sub);
  function find(runId, wanted, viewer = null) {
    if (runId === undefined) { const r = [...runs].reverse().find((x) => x.mode === wanted && mayRead(x, viewer)); return r ? { run: r, redact: false } : { none: 'no-run' }; }
    const r = runs.find((x) => x.id === runId);
    if (!r) return { none: 'unknown' };
    return r.mode === wanted ? { run: r, redact: r.held && !mayRead(r, viewer) } : { none: 'other-mode', runMode: r.mode };
  }

  // The record of one run, built from its stored facts only. Mock: simulated rows. Live: nothing a product logged or replied, so every layer says why.
  // redact: the viewer did not take part in this held run, so the people are left out of the words.
  async function record(run, { redact = false } = {}) {
    const obs = createRunObservability({ clock: now });
    const win = { runId: run.id, startedAt: run.startedAt, endedAt: run.endedAt };
    if (run.mode === 'live') {
      return obs.collectRun({ ...win, source: 'real', layers: Object.entries(LIVE_WHY).map(([layer, reason]) => ({ layer, products: [], reason })) });
    }
    const rows = run.facts.map((f) => ({ at: f.at, layer: f.layer, outcome: f.outcome, ...rowOf(f, redact) }));
    const lane = (layer) => ({ layer, simulated: rows.filter((r) => r.layer === layer), ...(MOCK_WHY[layer] ? { reason: MOCK_WHY[layer] } : {}) });
    return obs.collectRun({ ...win, source: 'mock', layers: ['person', 'agent', 'authorize', 'privilege', 'gateway', 'resource'].map(lane) });
  }

  // The Real gateway check: the replies the lab received, as `response` rows. Nothing is stored: the record goes straight back to the page.
  // replies: [{ at (epoch ms the reply came back), asked ('tools/list' | 'tools/call'), control, trace }]
  const gatewayCheck = async ({ startedAt, caller, replies }) => {
    try {
      const id = nextId();
      const rows = []; const noReply = [];
      for (const r of replies) {
        const at = new Date(r.at).toISOString();
        const step = r.asked === 'tools/list' ? 'gateway-list' : 'gateway-probe';
        const row = r.trace?.response && Number.isInteger(r.trace.response.status) ? replyRow({ ...r, at }) : null;
        if (row) rows.push(row); else noReply.push(`${r.asked} (${text(decisionsOf(r.trace)[0]?.evidence || 'no answer', 160)})`);
        try {
          write(`${at} ${SERVICE} decision layer=gateway step=${step} actor=${field(caller)} agent=- act-source=- tool=- result=${row ? RESULT[row.outcome] : 'no-reply'} mode=real cause=- count=1 run=${lineValue(id)}`);
        } catch (e) { fail('stdout write', e); }
      }
      const last = replies.reduce((m, r) => Math.max(m, r.at), startedAt);
      const reasons = { ...REAL_WHY, gateway: noReply.length ? `No reply came back, so nothing is claimed for it: ${noReply.join('; ')}.` : 'The gateway sent no reply this panel could use.' };
      const layers = ['person', 'agent', 'authorize', 'privilege', 'gateway', 'resource'].map((layer) => ({ layer, products: [], reason: reasons[layer], ...(layer === 'gateway' ? { responses: rows } : {}) }));
      const rec = await createRunObservability({ clock: now }).collectRun({ runId: id, startedAt, endedAt: last, source: 'real', layers });
      return { record: rec, noReply };
    } catch (e) {
      fail('gateway record', e);
      return { record: { error: e?.code || 'run_record_failed', message: 'The run record could not be built for this check.' }, noReply: [] };
    }
  };

  // `made` and `part` stay: an id from before a Reset is never reused
  const reset = () => { runs = []; byApproval = new Map(); refusal = null; clearTimeout(timer); };
  return { tool, approval, expired, refusedSignIn, find, record, gatewayCheck, reset, count: (m) => runs.filter((r) => !m || r.mode === m).length };
}

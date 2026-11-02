// explainDecision(): the plain-English "why" of one decision, built from the REAL evaluation.
//
// How: Cedar already answered allow/deny. To learn which rules applied and why the others did not, every active policy is
// taken apart into permit-only pieces (the whole policy, each scope part, each condition) and ONE more isAuthorized call
// asks Cedar which pieces hold for this exact request (same schema, entities and context decide() builds). Because every piece
// is a permit, diagnostics.reason lists all that hold and diagnostics.errors the ones that errored. English is then composed
// from those facts with fixed templates; nothing here is typed per scenario.
//
// The result is checked against decide()'s own answer. If the two disagree the explanation drops its per-rule reasons and
// says so (checks.agreed = false); it never states something it could not verify. decide(), the policy store and the audit log
// are not touched, and this module never throws into the caller (see index.js).
import { engine } from '../cedar/engine.js';
import { mapClaims } from '../cedar/mapClaims.js';
import { approversOf, classify, evaluate } from '../pep.js';
import { clausesOf, derivedFor, describeClause, rawClauseText } from './clauses.js';
import { kindOf, meaningOf } from './meaning.js';
import { andList, clean, orList, safe } from './names.js';

export const MAX_CLAUSES = 400;
export const MAX_SHOWN = 20;
const EARLY = new Set(['invalid-claims', 'invalid-request', 'error']);
const STATUS_TEXT = {
  allowed: 'Allowed it', blocked: 'Blocked it', held: 'Held it for approval', 'hold-moot': 'Would hold it, but the call is denied anyway',
  'not-applied': 'Did not apply', 'not-about-tool': 'Not about this tool',
};

const prepCache = new WeakMap();
/** Per policy set (a new object on every edit, so an edit invalidates it): JSON, clauses and the derived permit-only policies. */
function prepare(policySet) {
  const hit = prepCache.get(policySet);
  if (hit) return hit;
  const { cedar } = engine();
  const json = {};
  const clauses = {};
  let count = 0;
  for (const [id, text] of Object.entries(policySet.staticPolicies)) {
    const r = cedar.policyToJson(text);
    if (r.type !== 'success') throw new Error('policy could not be read');
    json[id] = r.json;
    clauses[id] = clausesOf(r.json);
    count += clauses[id].length + 1;
  }
  const degraded = count > MAX_CLAUSES;
  const derived = {};
  for (const id of Object.keys(json)) {
    const all = derivedFor(id, json[id]);
    for (const [k, v] of Object.entries(all)) if (!degraded || k.endsWith('|whole')) derived[k] = v;
  }
  const prep = { json, clauses, derived, degraded, count };
  prepCache.set(policySet, prep);
  return prep;
}

// Re-run a request with ONE named change (a counterfactual) so "what would change the answer" is only ever said after Cedar agreed.
// Returns the changed inputs, or null when a change cannot be made or two changes disagree.
function applyChanges(base, changes) {
  const claims = { ...base.claims };
  const next = { claims, args: { ...base.args }, pinnedHash: base.pinnedHash, observedHash: base.observedHash, approvalCount: base.approvalCount };
  const seen = new Map();
  for (const c of changes) {
    if (!c) return null;
    const open = ['group', 'noGroup', 'scope', 'noScope'].includes(c.kind);
    const key = open ? `${c.kind}:${c.value}` : c.kind;
    if (seen.has(key) && seen.get(key) !== c.value) return null;
    seen.set(key, c.value);
  }
  const groups = new Set(Array.isArray(claims.groups) ? claims.groups : []);
  const scopes = new Set(typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : []);
  for (const c of changes) {
    if (c.kind === 'amount') next.args.amount = c.value;
    else if (c.kind === 'approvals') next.approvalCount = c.value;
    else if (c.kind === 'drift') next.observedHash = c.value ? `${base.pinnedHash}-changed` : base.pinnedHash;
    else if (c.kind === 'group') groups.add(c.value);
    else if (c.kind === 'noGroup') groups.delete(c.value);
    else if (c.kind === 'scope') scopes.add(c.value);
    else if (c.kind === 'noScope') scopes.delete(c.value);
    else if (c.kind === 'attended') { if (c.value) delete claims.act; else claims.act = claims.act ?? { sub: 'agent' }; }
    else return null;
  }
  if (Array.isArray(claims.groups)) claims.groups = [...groups];
  if (typeof claims.scope === 'string' || scopes.size) claims.scope = [...scopes].join(' ');
  return next;
}

const same = (a, b) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
const upFirst = (t) => (t.startsWith('an admin') ? `An${t.slice(2)}` : t); // a name is never re-cased: in live mode it is the sign-in name
const plural = (n, one, many) => (n === 1 ? one : many);
const cutList = (items, max = MAX_SHOWN) => ({ shown: items.slice(0, max).map((s) => safe(s)), more: Math.max(0, items.length - max) });

// ---- the "before any rule" explanations -------------------------------------------------------------------------------
const BEFORE_WHY = (code, tool, problems) => ({
  'unknown-tool': `“${tool}” is not a tool this server offers.`,
  'invalid-arguments': `The arguments were not valid: ${problems.join('; ')}. Arguments are checked first so a missing value, such as an amount, can never skip a rule.`,
  'invalid-claims': `The token's details were rejected: ${problems.join('; ')}.`,
}[code] ?? 'The request could not be read or checked, so it was denied (the check fails closed).');

export function explainBefore({ code, problems = [], claims, tool, app, source }, deps) {
  const probs = problems.slice(0, 5).map((p) => safe(typeof p === 'string' ? p : p?.message, 120));
  const toolName = safe(tool, 80);
  const who = whoOf({ claims, source }, deps);
  return {
    v: 1, outcome: 'deny', kind: 'before-rules', headline: 'Denied before any rule was checked.',
    who, asked: { tool: toolName, app: app ? safe(app) : null, attended: !claims?.act, attendedText: '', details: [], approvalsSoFar: 0, schemaChanged: false, text: toolName ? `${toolName}${app ? ` (${safe(app)} app)` : code === 'unknown-tool' ? ' (not a tool this server offers)' : ''}.` : '' },
    why: BEFORE_WHY(code, toolName, probs), decidedBy: null, rules: [], change: null, approval: null, before: { code, problems: probs }, notes: [],
    checks: { agreed: true, rules: 0, clauses: 0 }, technical: { rule: code, reason: BEFORE_WHY(code, toolName, probs), rules: [], overridden: [], engine: engine().engineVersion },
  };
}

function whoOf({ claims, source }, { namer }) {
  const m = claims && typeof claims === 'object' ? mapClaims(claims) : { ok: false };
  const sub = typeof claims?.sub === 'string' ? claims.sub : '';
  const name = sub ? namer.nameOfSub(sub) : 'The caller';
  const actSub = typeof claims?.act?.sub === 'string' ? claims.act.sub : null;
  const agent = actSub ? { sub: safe(actSub), name: namer.agentName(actSub) } : null;
  const groups = cutList(m.ok ? m.entities.slice(1).map((e) => e.uid.id) : []); // the groups the rules actually see
  const scopes = cutList(m.ok ? m.token.scopes : []);
  const via = source === 'session' ? 'a mock sign-in (persona)' : source === 'test' ? 'details typed into Test a request'
    : source === 'approval' || source === undefined ? null : namer.mock() ? 'a mock access token' : 'a PingFederate access token';
  const more = (c) => (c.more ? ` and ${c.more} more` : '');
  const gtext = groups.shown.length ? `in the ${plural(groups.shown.length + groups.more, 'group', 'groups')} ${groups.shown.join(', ')}${more(groups)}` : 'with no groups in the token';
  const stext = scopes.shown.length ? `with the ${plural(scopes.shown.length + scopes.more, 'scope', 'scopes')} ${scopes.shown.join(' ')}${more(scopes)}` : 'with no scopes';
  const text = `${name}${sub && safe(sub).toLowerCase() !== name.toLowerCase() ? ` (sign-in name ${safe(sub)})` : ''}, ${gtext}, ${stext}.${agent ? ` ${agent.name} is acting for ${name}.` : ''}${via ? ` Signed in with ${via}.` : ''}`;
  return { sub: safe(sub), name, groups: groups.shown, groupsMore: groups.more, scopes: scopes.shown, scopesMore: scopes.more, agent, via, text };
}

// ---- the main explanation ---------------------------------------------------------------------------------------------
/**
 * ctx: { policySet, claims, tool, app, args, resource, pinnedHash, observedHash, approvalCount, source,
 *        d (decide result, optional), outcome (the PEP's final outcome, optional), approvalId, approval: { status, approver } }
 */
export function explainDecision(ctx, deps) {
  const { namer } = deps;
  const { cedar, schema: defaultSchema } = engine();
  const { policySet, claims, tool, app, args = {}, resource, pinnedHash, observedHash, approvalCount = 0, source } = ctx;
  const evalWith = (n) => evaluate({ policySet, claims, tool, app, args, pinnedHash, observedHash, approvalCount: n, resource });
  const d = ctx.d ?? evalWith(approvalCount);
  if (d.rules.length === 0 && EARLY.has(d.rule)) return explainBefore({ code: d.rule, problems: d.problems, claims, tool, app, source }, deps);

  const prep = prepare(policySet);
  const m = mapClaims(claims);
  const who = whoOf({ claims, source }, deps);
  const actor = m.token.actor ?? null;
  const attended = !actor;
  const action = actor ? 'mcp:InvokeUnattended' : 'mcp:Invoke';
  const cedarArgs = args && Object.hasOwn(args, 'amount') ? { amount: args.amount } : {};
  const schemaChanged = pinnedHash !== observedHash;

  // One Cedar call over the derived pieces.
  const r = cedar.isAuthorized({
    principal: m.principal, action: { type: 'Action', id: action }, resource: { type: 'Tool', id: tool },
    context: { app, args: cedarArgs, token: m.token, approval_count: approvalCount, pinnedHash, observedHash },
    schema: policySet.schema ?? defaultSchema, validateRequest: true,
    entities: [...m.entities, { uid: { type: 'Tool', id: tool }, attrs: resource ?? {}, parents: [] }],
    policies: { staticPolicies: prep.derived, templates: {}, templateLinks: [] },
  });
  const analysed = r.type === 'success';
  const sat = new Set(analysed ? r.response.diagnostics.reason : []);
  const errored = new Set(analysed ? r.response.diagnostics.errors.map((e) => e.policyId) : []);

  const facts = {
    name: who.name, tool: safe(tool, 80), app: safe(app), agent: who.agent?.name, amount: typeof cedarArgs.amount === 'number' ? cedarArgs.amount : undefined,
    repo: typeof resource?.repo === 'string' ? safe(resource.repo) : undefined, classification: typeof resource?.classification === 'string' ? safe(resource.classification) : undefined,
    client_id: m.token.client_id,
  };

  // ---- per rule
  const reads = new Set();
  const rules = Object.keys(policySet.staticPolicies).map((id) => {
    const json = prep.json[id];
    const kind = kindOf(json);
    const applied = sat.has(`${id}|whole`);
    const parts = prep.degraded ? [] : prep.clauses[id].map((c) => {
      const d2 = describeClause(c, facts);
      if (d2.reads) reads.add(d2.reads);
      return { c, d: d2, ok: sat.has(`${id}|${c.key}`) };
    });
    if (prep.degraded) for (const c of prep.clauses[id]) { const x = describeClause(c, facts); if (x.reads) reads.add(x.reads); }
    // Cedar checks the conditions in order and stops at the first one that fails or errors. Later ones (for example an
    // `unless` that errors because the `when` before it already said "no repository") are only its shadow: never reported.
    let stopped = false;
    for (const p of parts) {
      if (p.c.scope) continue;
      if (stopped) p.ignored = true;
      else if (!p.ok) stopped = true;
      p.errored = !p.ok && errored.has(`${id}|${p.c.key}`);
    }
    return { id, json, kind, applied, parts, unknown: parts.some((p) => !p.d.known), reason: json.annotations?.reason ? clean(json.annotations.reason) : null };
  });

  // ---- the verifier: our per-rule reading must reproduce decide()'s own answer
  const permitsApplied = rules.filter((x) => x.applied && x.kind === 'allow').map((x) => x.id);
  const forbidsApplied = rules.filter((x) => x.applied && x.kind !== 'allow').map((x) => x.id);
  let agreed = analysed
    && (permitsApplied.length > 0 && forbidsApplied.length === 0 ? 'allow' : 'deny') === d.decision
    && same(d.decision === 'allow' ? permitsApplied : forbidsApplied, d.rules)
    && (d.decision === 'allow' || forbidsApplied.length === 0 || same(permitsApplied, d.overridden));
  if (agreed && !prep.degraded) {
    agreed = rules.every((x) => (x.applied ? x.parts.every((p) => p.ok) : x.parts.length === 0 || x.parts.some((p) => !p.ok)));
  }

  // ---- outcome and the approval re-run
  const holdClass = d.decision === 'deny' && classify(d, policySet) === 'hold';
  let approvalWouldAllow = null;
  let afterApproval = null; // the same request with one approval recorded
  if (d.decision === 'deny' && d.rules.length && ctx.outcome !== 'hold') { afterApproval = evalWith(1); approvalWouldAllow = afterApproval.decision === 'allow'; }
  const outcome = ctx.outcome ?? (d.decision === 'allow' ? 'allow' : holdClass && approvalWouldAllow ? 'hold' : 'deny');
  const kind = outcome === 'allow' ? 'allowed' : outcome === 'hold' ? 'held' : d.rules.length === 0 ? 'default-deny' : holdClass ? 'hold-no-way-through' : 'blocked';

  // What Cedar answers when the request has the given changes: { result: 'allow' | 'hold' | 'deny', by, approverSubs }, or null if it cannot be asked.
  const simulate = (changes) => {
    const next = applyChanges({ claims, args, pinnedHash, observedHash, approvalCount }, changes);
    if (!next) return null;
    const run = (n) => evaluate({ policySet, claims: next.claims, tool, app, args: next.args, pinnedHash: next.pinnedHash, observedHash: next.observedHash, approvalCount: n, resource });
    const r1 = run(next.approvalCount);
    if (r1.decision === 'allow') return { result: 'allow' };
    if (r1.rules.length && classify(r1, policySet) === 'hold' && run(Math.max(next.approvalCount, 1)).decision === 'allow') {
      return { result: 'hold', approverSubs: [...new Set(r1.rules.flatMap((id) => approversOf(policySet, id)))] };
    }
    return { result: 'deny', by: r1.rules.length ? r1.rule : null };
  };

  const meaningOfRule = (x) => meaningOf({ id: x.id, text: policySet.staticPolicies[x.id], json: x.json }, namer);
  const meanings = Object.fromEntries(rules.map((x) => [x.id, meaningOfRule(x)]));
  const label = (id) => `“${meanings[id].reason ?? id}” (${id})`;
  const saysLine = (id) => (meanings[id].explainedFrom === 'text' ? `applies to this request (explained from its text)` : `says: ${meanings[id].does}`);

  // ---- status, reasons
  const decidingId = d.rules.length ? d.rule : null;
  const unattendedWord = attended ? null : who.agent?.name;
  for (const x of rules) {
    const fromText = !agreed || prep.degraded || x.unknown;
    x.explainedFrom = fromText ? 'text' : 'structure';
    const failing = x.parts.filter((p) => !p.ok && !p.ignored);
    const phrase = (p) => {
      if (!p.d.known) return `a condition written in Cedar was not met: ${rawClauseText(cedar, p.c)}`;
      if (p.c.part === 'unless') return p.errored ? 'an exception to this rule could not be checked for this request' : `${p.d.pass}, which is an exception to this rule`;
      return p.d.fail;
    };
    if (x.applied) {
      x.status = x.kind === 'allow' ? (outcome === 'allow' ? 'allowed' : 'overridden')
        : x.kind === 'hold' ? (outcome === 'hold' ? 'held' : 'hold-moot') : 'blocked';
      x.because = !agreed || x.kind === 'allow' || x.unknown ? [] : x.parts.map((p) => (p.c.part === 'unless' ? p.d.fail : p.d.pass)).filter(Boolean);
    } else {
      const selector = !x.unknown && agreed && failing.find((p) => p.d.selector && p.c.part !== 'unless');
      x.status = selector ? 'not-about-tool' : 'not-applied';
      x.because = !agreed || prep.degraded ? [] : selector ? [selector.d.fail] : failing.slice(0, 3).map(phrase);
    }
    x.deciding = x.id === decidingId;
  }
  const ranks = { allowed: 0, held: 0, blocked: 0, overridden: 1, 'hold-moot': 1, 'not-applied': 2, 'not-about-tool': 3 };
  const rank = (x) => (x.deciding ? -1 : ranks[x.status] ?? 2);
  const ordered = [...rules].sort((a, b) => rank(a) - rank(b));
  const statusText = (x) => (x.status === 'overridden' ? (outcome === 'hold' ? 'Would allow it once the hold is cleared' : 'Would have allowed it, but a block rule beat it') : STATUS_TEXT[x.status]);

  // ---- names and sentences
  const approverSubs = [...new Set(d.rules.flatMap((id) => approversOf(policySet, id)))];
  const approvers = approverSubs.map((s) => ({ sub: safe(s), name: namer.nameOfSub(s) }));
  // The requester can never approve their own call (only another approver or an admin can), so they are not named as the one who will.
  const requesterIsApprover = typeof claims?.sub === 'string' && approverSubs.includes(claims.sub);
  const deciders = approvers.filter((a) => a.sub !== safe(claims?.sub));
  const approverNames = orList([...deciders.map((a) => a.name), ...(requesterIsApprover ? ['an admin'] : [])]);
  const tl = safe(tool, 80);
  const live = !namer.mock();
  const decRule = decidingId ? rules.find((x) => x.id === decidingId) : null;
  const decKind = decRule ? (decRule.kind === 'allow' ? 'allow' : decRule.kind === 'hold' ? 'hold' : 'block') : 'default';
  const otherForbids = forbidsApplied.filter((id) => id !== decidingId);
  const allowReason = d.overridden.length ? label(d.overridden[0]) : null;
  const permitCount = rules.filter((x) => x.kind === 'allow').length;
  const blockCount = rules.length - permitCount;
  const apv = ctx.approval;
  const approverOf = apv?.approver ? namer.nameOfSub(apv.approver) : null;

  const stillBy = kind === 'hold-no-way-through' && afterApproval?.rules.length ? afterApproval.rule : null; // still denying with an approval recorded
  let headline;
  let why;
  if (kind === 'allowed') {
    headline = `Allowed. ${who.name} may use ${tl} here: an allow rule covers it and no block rule applies.`;
    why = `The rule ${label(d.rule)} ${saysLine(d.rule)} This request fits it, and ${blockCount === 0 ? 'there are no block rules' : blockCount === 1 ? 'the 1 block or hold rule does not apply' : `none of the ${blockCount} block or hold rules apply`}.`;
    if (apv) {
      headline = `${approverOf} approved. ${tl} ran once.`;
      why = `${approverOf} approved. The rules were checked again with one approval recorded and now allow it, so ${tl} ran once.`;
    }
  } else if (kind === 'default-deny') {
    headline = `Denied. No rule allows ${who.name} to use ${tl} in this way.`;
    why = permitCount === 0 ? 'There are no allow rules at all, so every call is denied. This is called default deny.'
      : `A call is allowed only when an allow rule covers it. ${permitCount} allow ${plural(permitCount, 'rule was', 'rules were')} checked and ${permitCount === 1 ? 'it does not cover' : 'none covers'} this request, so it is denied. This is called default deny.`;
  } else if (kind === 'blocked') {
    headline = `Denied. A block rule applies: “${decRule.reason ?? decRule.id}”.`;
    why = `The rule ${label(decidingId)} ${saysLine(decidingId)} This request fits it, so it is blocked${allowReason ? `, even though ${allowReason} would have allowed it` : ''}. A block rule always beats an allow rule.`
      + (otherForbids.length ? ` ${otherForbids.length} other ${plural(otherForbids.length, 'rule also applies', 'rules also apply')}: ${otherForbids.join(', ')}.` : '');
  } else if (kind === 'held') {
    headline = `Held. ${upFirst(approverNames)} must approve this before ${tl} runs.`;
    why = `The rule ${label(decidingId)} ${saysLine(decidingId)} This request fits it and has ${approvalCount} ${plural(approvalCount, 'approval', 'approvals')} so far, so it is held for ${approverNames}.`;
  } else if (stillBy) {
    headline = stillBy === decidingId ? 'Denied. A hold rule applies, and an approval would not lift it.' : 'Denied. A hold rule applies, but even with an approval another rule would deny this.';
    why = stillBy === decidingId
      ? `The rule ${label(decidingId)} would hold this for ${approverNames}, but it still applies once an approval is recorded, so approving does not release it.`
      : `The rule ${label(decidingId)} would hold this for ${approverNames}, but with an approval recorded ${label(stillBy)} would still deny it.`;
  } else {
    headline = 'Denied. A hold rule applies, but even with an approval no rule would allow this.';
    why = `The rule ${label(decidingId)} would hold this for ${approverNames}, but with an approval recorded no allow rule covers the request either, so there is nothing for an approval to unlock.`;
  }
  if (apv && kind !== 'allowed') {
    headline = `${approverOf} approved, but the rules still deny it.`;
    why = `${approverOf} approved. The rules were checked again with one approval recorded and still deny it (${clean(d.reason)}), so ${tl} did not run.`;
  }

  // ---- what would change the answer
  // Every "would allow / would stop applying" line below was checked: the request is run again with that one change (simulate()).
  const needs = (x) => x.parts.filter((p) => !p.ok && !p.ignored);
  const then = (sim) => {
    if (!sim) return ' (other rules could still change the answer)';
    if (sim.result === 'allow') return ', and the call would then be allowed';
    if (sim.result === 'hold') return `, and the call would then be held for ${orList(sim.approverSubs.map((sub) => namer.nameOfSub(sub)))} to approve`;
    return `, but the call would still be denied${sim.by ? ` by ${label(sim.by)}` : ' (no rule would allow it)'}`;
  };
  let change = null;
  if (outcome === 'hold') {
    change = { text: `${upFirst(approverNames)} approves it on the Approvals page.`, items: [], complete: true };
  } else if (stillBy && agreed && !prep.degraded) {
    change = { text: `Approving would not be enough. ${label(stillBy)} still applies once the call is approved, so an admin would have to change the rule.`, items: [], complete: true };
  } else if ((kind === 'default-deny' || kind === 'hold-no-way-through') && agreed && !prep.degraded) {
    const items = [];
    const sentences = [];
    let complete = true;
    for (const x of rules.filter((y) => y.kind === 'allow' && y.status === 'not-applied')) {
      const failing = needs(x);
      if (x.unknown || failing.some((p) => !p.d.need)) { complete = false; continue; }
      const text = failing.map((p) => (p.c.part === 'unless' ? p.d.needNot : p.d.need)).join(' and ');
      const sim = simulate(failing.map((p) => (p.c.part === 'unless' ? p.d.cfNot : p.d.cf)));
      if (!sim) complete = false;
      items.push({ ruleId: x.id, text });
      sentences.push(sim?.result === 'allow' ? `${label(x.id)} would allow it if ${text}.` : `${label(x.id)} would cover it if ${text}${then(sim)}.`);
    }
    const lead = kind === 'hold-no-way-through' ? 'Even approved, nothing allows it. ' : '';
    const none = rules.every((y) => y.kind !== 'allow' || y.status === 'not-about-tool');
    change = { text: `${lead}${sentences.length ? sentences.join(' ') : none ? `No allow rule is about ${tl} yet. An admin would have to add one.` : 'Some conditions could not be put in words; see the rules\' text.'}`, items, complete: complete && (sentences.length > 0 || none) };
  } else if (kind === 'blocked' && agreed && !prep.degraded) {
    const blocks = rules.filter((x) => x.status === 'blocked');
    const noApprover = `No approver is named for ${andList(blocks.map((x) => label(x.id)))}, so ${approvalWouldAllow ? 'no approval request is opened' : 'an approval cannot lift it'}.`;
    const items = [];
    const sentences = [];
    let complete = true;
    for (const x of blocks) {
      if (x.unknown) { complete = false; continue; }
      const opts = x.parts.filter((p) => !p.d.selector && ((p.c.part === 'when' && p.d.needNot) || (p.c.part === 'unless' && p.d.need)))
        .map((p) => ({ text: p.c.part === 'when' ? p.d.needNot : p.d.need, sim: simulate([p.c.part === 'when' ? p.d.cfNot : p.d.cf]) }));
      items.push({ ruleId: x.id, text: opts.length ? orList(opts.map((o) => o.text)) : '' });
      if (!opts.length) sentences.push(`Nothing in the request itself would stop ${label(x.id)} applying; an admin would have to change the rule.`);
      opts.forEach((o, i) => sentences.push(`${i === 0 ? `${label(x.id)} would stop applying` : 'It would also stop applying'} if ${o.text}${then(o.sim)}.`));
    }
    change = { text: `${noApprover} ${sentences.join(' ')}${complete ? '' : " Some conditions could not be put in words; see the rule's text."}`.trim(), items, complete };
  }

  // ---- approval
  const mayApprove = approvers.length > 0 && (outcome === 'hold' || kind === 'hold-no-way-through');
  const approval = mayApprove ? {
    approvers, where: '/approvals', requesterMayApprove: false, approvalWouldAllow: outcome === 'hold' ? true : approvalWouldAllow === true,
    text: outcome === 'hold'
      ? `${upFirst(approverNames)} can approve it on the Approvals page (${live ? "with an approver's token" : `sign in as ${approverNames}`}). Approving checks the rules again with one approval recorded and runs ${tl} once.${requesterIsApprover ? ` ${who.name} cannot approve their own request, so another approver or an admin must.` : ''}`
      : `${approverNames} could approve it, but the rules would still deny it afterwards, so no approval request is opened.`,
  } : null;

  const dec = decRule ? { id: decRule.id, kind: decKind, reason: decRule.reason, does: meanings[decRule.id].does } : { id: 'default-deny', kind: 'default', reason: null, does: null };
  const rulesOut = ordered.map((x) => ({
    id: x.id, kind: x.kind, reason: x.reason, status: x.status, statusText: statusText(x), because: x.because, deciding: x.deciding, oneLine: meanings[x.id].oneLine, explainedFrom: x.explainedFrom,
  }));

  const details = [];
  if (reads.has('amount') && facts.amount !== undefined) details.push({ label: 'amount', value: String(facts.amount) });
  if (reads.has('repo') && facts.repo) details.push({ label: 'repository', value: facts.repo });
  if (reads.has('classification') && facts.classification) details.push({ label: 'data classification', value: facts.classification });
  const attendedText = attended ? `attended: ${who.name} made the call directly (the token has no agent)` : `unattended: ${unattendedWord} made the call for ${who.name} (the token carries an agent)`;
  const notes = [];
  if (!agreed) notes.push('Per-rule detail could not be checked for this request. The decision above is Cedar\'s own answer.');
  if (!attended) notes.push("Rules look at the person's groups. The agent's own groups are not used.");
  if (prep.degraded) notes.push('There are too many rules to explain one by one, so each is shown as a whole.');

  return {
    v: 1, outcome, kind, headline, who,
    asked: {
      tool: tl, app: safe(app), attended, attendedText, details, approvalsSoFar: approvalCount, schemaChanged,
      text: `${tl} (${safe(app)} app)${details.map((x) => `, ${x.label} ${x.value}`).join('')}. ${attended ? 'Attended' : 'Unattended'}: ${attended ? `${who.name} made the call directly.` : `${unattendedWord} made the call for ${who.name}.`} Approvals so far: ${approvalCount}. Tool schema: ${schemaChanged ? 'changed since it was approved' : 'matches the approved version'}.`,
    },
    why, decidedBy: dec, rules: rulesOut, change, approval, before: null, notes,
    checks: { agreed, rules: rules.length, clauses: prep.count },
    technical: { rule: d.rule, reason: clean(d.reason), rules: d.rules.map((s) => safe(s, 100)), overridden: d.overridden.map((s) => safe(s, 100)), engine: engine().engineVersion },
  };
}

/** Answers that are not a rule evaluation: the approver said no, or nobody answered in time. */
export function explainAnswer({ status, claims, tool, app, args, approverSubs = [], approver, approvalCount = 0 }, deps) {
  const { namer } = deps;
  const who = whoOf({ claims, source: 'approval' }, deps);
  const tl = safe(tool, 80);
  const names = orList(approverSubs.map((s) => namer.nameOfSub(s)));
  const denied = status === 'denied';
  const by = approver ? namer.nameOfSub(approver) : 'The approver';
  const details = [];
  if (typeof args?.amount === 'number') details.push({ label: 'amount', value: String(args.amount) });
  return {
    v: 1, outcome: 'deny', kind: denied ? 'approval-denied' : 'approval-expired',
    headline: denied ? `${by} denied this request, so ${tl} did not run.` : `Nobody answered in time, so the call stays denied and ${tl} did not run.`,
    who, asked: { tool: tl, app: safe(app), attended: !claims?.act, attendedText: claims?.act ? 'unattended' : 'attended', details, approvalsSoFar: approvalCount, schemaChanged: false, text: `${tl} (${safe(app)} app).` },
    why: denied ? `${by} chose to deny the held request. No rule was checked again; the answer of the person counts.`
      : `The request was held for ${names || 'an approver'} and the time ran out. A held call that nobody answers stays denied.`,
    decidedBy: null, rules: [], change: null, approval: null, before: null, notes: [], checks: { agreed: true, rules: 0, clauses: 0 },
    technical: { rule: denied ? 'approver-denied' : 'approval-expired', reason: '', rules: [], overridden: [], engine: engine().engineVersion },
  };
}

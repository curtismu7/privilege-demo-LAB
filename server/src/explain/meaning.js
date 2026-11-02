// What a policy means, in plain words, built from its structure (policyToJson) and nothing else. A policy whose shape we cannot
// put into words is "explained from its text": its @reason and its Cedar source are shown and nothing is invented.
import { engine } from '../cedar/engine.js';
import { clausesOf, describeClause, rawClauseText } from './clauses.js';
import { clean, orList } from './names.js';

const KIND_LABEL = { allow: 'Allow rule', block: 'Block rule', hold: 'Hold rule' };
const COMBINES = {
  allow: 'An allow rule lets a call through only if no block rule applies to it.',
  block: 'A block rule always beats an allow rule. No approver is named, so a person cannot lift it.',
  hold: 'A hold rule stops the call until a named person approves. Then the rules are checked again.',
};
export const DEFAULT_DENY_LINE = 'If no rule applies at all, the call is denied (default deny).';

const approversOfJson = (json) => String(json?.annotations?.approvers ?? '').split(/[\s,]+/).filter(Boolean);
export const kindOf = (json) => (json.effect === 'permit' ? 'allow' : approversOfJson(json).length ? 'hold' : 'block');

/**
 * meaningOf({ id, state, text }, { nameOfSub }) -> the Meaning object (see docs/architecture.md).
 * `json` may be passed when the caller already has it (decision.js does).
 */
export function meaningOf({ id, state = 'active', text, json = null }, { nameOfSub = (s) => s } = {}) {
  const { cedar } = engine();
  let j = json;
  if (!j) {
    try {
      const r = cedar.policyToJson(text);
      j = r.type === 'success' ? r.json : null;
    } catch { j = null; }
  }
  const base = { id, state, source: text ?? '', unexplained: [] };
  if (!j) {
    const does = 'This rule could not be put into words. Its Cedar text is shown below.';
    return { ...base, kind: null, kindLabel: 'Rule', cedar: null, oneLine: does, does, who: { text: '', groups: [], anyone: false }, attended: { applies: 'any', text: '' },
      what: { text: '', tools: null, apps: null }, conditions: [], approval: null, combines: DEFAULT_DENY_LINE, reason: null, explainedFrom: 'text' };
  }
  const kind = kindOf(j);
  const reason = j.annotations?.reason ? clean(j.annotations.reason) : null;
  const approvers = approversOfJson(j).map((sub) => ({ sub, name: nameOfSub(sub) }));
  const head = { ...base, kind, kindLabel: KIND_LABEL[kind], cedar: j.effect, reason, combines: `${COMBINES[kind]} ${DEFAULT_DENY_LINE}`,
    approval: approvers.length ? { approvers, clearsOnApproval: false } : null };

  const clauses = clausesOf(j).map((c) => ({ c, d: describeClause(c) }));
  const unknown = clauses.filter((x) => !x.d.known);
  if (unknown.length) {
    const does = reason ? `Explained from its text: “${reason}”.` : 'This rule could not be put into words. Its Cedar text is shown below.';
    return { ...head, oneLine: does, does, who: { text: '', groups: [], anyone: false }, attended: { applies: 'any', text: '' }, what: { text: '', tools: null, apps: null },
      conditions: [], explainedFrom: 'text', unexplained: unknown.map((x) => rawClauseText(cedar, x.c)) };
  }

  const scope = (part) => clauses.find((x) => x.c.part === part)?.d ?? null;
  const principal = scope('principal');
  const action = scope('action');
  const anyone = !principal;
  const who = { text: principal?.who ?? 'anyone', groups: principal?.groups ?? [], anyone };
  const applies = action?.attended ?? 'any';
  const calls = { both: 'calls (attended or unattended)', attended: 'attended calls', unattended: 'unattended calls', any: 'any call' }[applies];

  const whats = clauses.filter((x) => x.d.inWhat && x.c.part !== 'unless'); // an `unless` names an exception, not what the rule is about
  const what = { text: whats.length ? whats.map((x) => x.d.what).join(' and ') : 'any tool', tools: null, apps: null };
  const tools = clauses.filter((x) => x.c.part === 'resource' && x.d.inWhat).map((x) => x.d.what);
  if (tools.length) what.tools = tools;

  const conds = clauses.filter((x) => x.c.part === 'when' && !x.d.inWhat);
  const excs = clauses.filter((x) => x.c.part === 'unless');
  const clearsOnApproval = excs.some((x) => x.d.approval);
  // An approval exception on a hold rule is told in the closing sentence; on an allow or block rule it is a real condition and is shown.
  const shownExcs = kind === 'hold' ? excs.filter((x) => !x.d.approval) : excs;
  const conditions = [...conds.map((x) => ({ kind: 'when', text: x.d.text })), ...shownExcs.map((x) => ({ kind: 'unless', text: x.d.text }))];
  const tail = `${conds.length ? ` when ${conds.map((x) => x.d.text).join(' and ')}` : ''}${shownExcs.length ? `${conds.length ? ',' : ''} unless ${orList(shownExcs.map((x) => x.d.text))}` : ''}`;
  const from = anyone ? '' : ` from ${who.text}`;

  let does;
  if (kind === 'allow') does = `Lets ${who.text} make ${calls} to ${what.text}${tail}.`;
  else if (kind === 'block') does = `Blocks ${calls}${from} to ${what.text}${tail}.`;
  else does = `Holds ${calls}${from} to ${what.text}${tail}, until ${orList(approvers.map((a) => a.name))} approves.${clearsOnApproval ? ' It stops applying once someone has approved the call.' : ' An approval does not clear this rule.'}`;

  const combines = kind === 'hold' && !clearsOnApproval
    ? `A hold rule stops the call until a named person approves, but this one still applies after an approval, so approving does not release it. ${DEFAULT_DENY_LINE}` : head.combines;
  return { ...head, combines, oneLine: does, does, who, attended: { applies, text: calls }, what, conditions, explainedFrom: 'structure',
    approval: approvers.length ? { approvers, clearsOnApproval } : null };
}

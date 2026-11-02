// Pure work on a policy's JSON (cedar.policyToJson): split it into ordered clauses and put each clause into words.
// A clause is one scope part (principal, action, resource) or one `when` / `unless` condition (a top-level && of a `when` is
// split into its conjuncts). describeClause() returns what the clause means, what it says when it holds or fails for a real
// request, and what would flip it. Anything it does not recognise is { known: false }: the caller then shows the Cedar text
// and says "explained from its text". Nothing here evaluates anything: Cedar does that (see decision.js).
import { andList, orList } from './names.js';

const UNKNOWN = Object.freeze({ known: false });
const ACTION = { attended: 'mcp:Invoke', unattended: 'mcp:InvokeUnattended' };
export const MAX_LIST = 4;

const only = (e) => (e && typeof e === 'object' && Object.keys(e).length === 1 ? Object.keys(e)[0] : null);
const lit = (e) => (e && typeof e === 'object' && Object.hasOwn(e, 'Value') ? e.Value : undefined);
const entityOf = (v) => (v && typeof v === 'object' && v.__entity ? v.__entity : null);
// "context.args.amount", "resource.repo", "principal" ... or null when the expression is not a plain attribute path
function pathOf(e) {
  const k = only(e);
  if (k === 'Var') return String(e.Var);
  if (k === '.') { const base = pathOf(e['.'].left); return base ? `${base}.${e['.'].attr}` : null; }
  return null;
}
const entityScope = (s) => (s?.entity ? s.entity : null);

/** Flatten a top-level && into its conjuncts, left to right. */
const conjuncts = (e) => (only(e) === '&&' ? [...conjuncts(e['&&'].left), ...conjuncts(e['&&'].right)] : [e]);

/** The ordered clauses of one policy's JSON. Scope parts that are `All` are not clauses (they always hold). */
export function clausesOf(json) {
  const out = [];
  for (const part of ['principal', 'action', 'resource']) {
    if (json[part] && json[part].op !== 'All') out.push({ key: part, part, scope: json[part] });
  }
  (json.conditions ?? []).forEach((c, i) => {
    const parts = c.kind === 'when' ? conjuncts(c.body) : [c.body];
    parts.forEach((expr, j) => out.push({ key: `${c.kind}${i}.${j}`, part: c.kind, group: i, expr }));
  });
  return out;
}

// ---- phrase helpers -------------------------------------------------------------------------------------------------
const OPS = {
  // yes / no: an amount that makes the comparison true / false (used to re-run a request with that one change)
  '>': { word: 'over', neg: (n) => `${n} or less`, not: '<=', yes: (n) => n + 1, no: (n) => n },
  '>=': { word: 'at least', neg: (n) => `under ${n}`, not: '<', yes: (n) => n, no: (n) => n - 1 },
  '<': { word: 'under', neg: (n) => `${n} or more`, not: '>=', yes: (n) => n - 1, no: (n) => n },
  '<=': { word: 'at most', neg: (n) => `over ${n}`, not: '>', yes: (n) => n, no: (n) => n + 1 },
  '==': { word: 'exactly', neg: (n) => `not ${n}`, not: '!=', yes: (n) => n, no: (n) => n + 1 },
  '!=': { word: 'not', neg: (n) => `exactly ${n}`, not: '==', yes: (n) => n + 1, no: (n) => n },
};

// ["a", "b"] when the expression is context.app == "a" || context.app == "b" ..., else null
function appsOf(e) {
  if (only(e) === '||') {
    const l = appsOf(e['||'].left);
    const r = l && appsOf(e['||'].right);
    return l && r ? [...l, ...r] : null;
  }
  return only(e) === '==' && pathOf(e['=='].left) === 'context.app' && typeof lit(e['=='].right) === 'string' ? [lit(e['=='].right)] : null;
}

function amountClause(op, n, f) {
  const { word, neg } = OPS[op];
  const a = f.amount;
  return {
    known: true, reads: 'amount',
    text: `the amount is ${word} ${n}`,
    pass: `the amount ${a} is ${word} ${n}`,
    fail: typeof a !== 'number' ? 'no amount was given' : op === '!=' ? `the amount is ${n}` : `the amount ${a} is not ${word} ${n}`,
    need: `the amount were ${word} ${n}`,
    needNot: `the amount were ${neg(n)}`,
    cf: { kind: 'amount', value: OPS[op].yes(n) }, cfNot: { kind: 'amount', value: OPS[op].no(n) },
  };
}

const listText = (items) => (items.length > MAX_LIST ? `${items.slice(0, MAX_LIST).join(', ')} and ${items.length - MAX_LIST} more` : andList(items));
const quote = (s) => `“${s}”`;

function negate(x) {
  if (!x.known) return UNKNOWN;
  return { known: true, reads: x.reads, text: `it is not the case that ${x.text}`, pass: x.fail, fail: x.pass, need: x.needNot ?? null, needNot: x.need ?? null, cf: x.cfNot, cfNot: x.cf };
}

// ---- conditions -----------------------------------------------------------------------------------------------------
function describeExpr(e, f) {
  const k = only(e);
  if (!k) return UNKNOWN;
  const b = e[k];
  if (k === '!') return negate(describeExpr(b.arg, f));
  if (k === '||') {
    const apps = appsOf(e);
    return apps ? appsClause(apps, f) : UNKNOWN;
  }
  if (k === 'has') {
    const base = pathOf(b.left);
    if (base === 'context.args' && b.attr === 'amount') {
      return { known: true, reads: 'amount', text: 'an amount is given', pass: 'an amount is given', fail: 'no amount was given', need: 'an amount were given', needNot: null };
    }
    if (base === 'resource' && b.attr === 'repo') {
      return { known: true, reads: 'repo', text: 'the call names a repository', pass: 'the call names a repository', fail: 'the call names no repository', need: 'the call named a repository', needNot: null };
    }
    return UNKNOWN;
  }
  if (k in OPS) {
    const left = pathOf(b.left);
    const right = lit(b.right);
    if (left === 'context.args.amount' && typeof right === 'number') return amountClause(k, right, f);
    if (left === 'context.approval_count' && typeof right === 'number' && ((k === '>=' && right === 1) || (k === '>' && right === 0))) {
      return {
        known: true, approval: true, text: 'someone has approved the call', pass: 'someone has approved this call', fail: 'nobody has approved it yet',
        need: 'someone approved the call', needNot: 'nobody had approved the call',
        cf: { kind: 'approvals', value: 1 }, cfNot: { kind: 'approvals', value: 0 },
      };
    }
    if (left === 'context.pinnedHash' && pathOf(b.right) === 'context.observedHash' && (k === '!=' || k === '==')) {
      const changed = {
        known: true, text: "the tool's description or schema has changed since it was approved", pass: "the tool's description or schema changed since it was approved",
        fail: 'the tool still matches the version that was approved', need: "the tool's description or schema changed", needNot: 'the tool matched the approved version again',
        cf: { kind: 'drift', value: true }, cfNot: { kind: 'drift', value: false },
      };
      return k === '!=' ? changed : negate(changed);
    }
    if ((k === '==' || k === '!=') && typeof right === 'string') {
      const eq = stringEquals(left, right, f);
      if (!eq.known) return UNKNOWN;
      return k === '==' ? eq : negate(eq);
    }
    return UNKNOWN;
  }
  if (k === 'contains') {
    const left = b.left;
    const right = b.right;
    if (pathOf(left) === 'context.token.scopes' && typeof lit(right) === 'string') {
      const s = lit(right);
      return { known: true, text: `the token has the ${s} scope`, pass: `the token has the ${s} scope`, fail: `the token does not have the ${s} scope`, need: `the token had the ${s} scope`, needNot: `the token did not have the ${s} scope`,
        cf: { kind: 'scope', value: s }, cfNot: { kind: 'noScope', value: s } };
    }
    if (only(left) === 'Set' && Array.isArray(left.Set)) {
      const items = left.Set.map(lit);
      if (pathOf(right) === 'resource' && items.every((v) => entityOf(v)?.type === 'Tool')) return toolsClause(items.map((v) => entityOf(v).id), f);
      if (pathOf(right) === 'resource.repo' && items.every((v) => typeof v === 'string')) {
        const list = items.join(', ');
        return {
          known: true, reads: 'repo', text: `the repository is one of ${list}`, pass: f.repo ? `the repository ${f.repo} is one of ${list}` : `the repository is one of ${list}`,
          fail: f.repo ? `the repository ${f.repo} is not one of ${list}` : `the repository is not one of ${list}`, need: `the repository were one of ${list}`, needNot: `the repository were not one of ${list}`,
        };
      }
    }
    return UNKNOWN;
  }
  if (k === 'like' && pathOf(b.left) === 'resource.toolName' && Array.isArray(b.pattern)) {
    const parts = b.pattern.map((p) => (p === 'Wildcard' ? '*' : p.Literal));
    const glob = parts.join('');
    const prefix = glob.endsWith('*') && !glob.slice(0, -1).includes('*') ? glob.slice(0, -1) : null;
    const text = prefix !== null ? `the tool name starts with “${prefix}”` : `the tool name matches ${quote(glob)}`;
    return { known: true, selector: true, text, pass: text,
      fail: prefix !== null ? `${f.tool ?? 'the tool'} does not start with “${prefix}”` : `${f.tool ?? 'the tool'} does not match ${quote(glob)}`, need: null, needNot: null };
  }
  if (k === 'in' && pathOf(b.left) === 'principal') {
    const ent = entityOf(lit(b.right));
    if (ent?.type === 'Group') return groupClause(ent.id, f, 'the person');
  }
  return UNKNOWN;
}

function stringEquals(left, v, f) {
  if (left === 'context.app') return appsClause([v], f);
  if (left === 'resource.classification') {
    return { known: true, reads: 'classification', text: `the data is classified ${v}`, pass: `the data is classified ${v}`,
      fail: f.classification ? `the data is classified ${f.classification}, not ${v}` : `the data is not classified ${v}`, need: `the data were classified ${v}`, needNot: `the data were not classified ${v}` };
  }
  if (left === 'resource.repo') {
    return { known: true, reads: 'repo', text: `the repository is ${v}`, pass: `the repository is ${v}`, fail: f.repo ? `the repository ${f.repo} is not ${v}` : `the repository is not ${v}`, need: `the repository were ${v}`, needNot: `the repository were not ${v}` };
  }
  if (left === 'context.token.client_id') {
    return { known: true, text: `the calling app is ${v}`, pass: `the calling app is ${v}`, fail: `the calling app is not ${v}`, need: `the calling app were ${v}`, needNot: `the calling app were not ${v}` };
  }
  return UNKNOWN;
}

const groupClause = (g, f, who) => ({
  known: true, text: `${who} is in the ${g} group`, pass: `${f.name ?? who} is in the ${g} group`, fail: `${f.name ?? who} is not in the ${g} group`,
  need: `${f.name ?? who} were in the ${g} group`, needNot: `${f.name ?? who} were not in the ${g} group`, group: g,
  cf: { kind: 'group', value: g }, cfNot: { kind: 'noGroup', value: g },
});

function appsClause(apps, f) {
  const names = orList(apps);
  return {
    known: true, selector: true, inWhat: true, what: `tools in the ${names} app`, text: `the tool is in the ${names} app`, pass: `the tool is in the ${names} app`,
    fail: `this rule is about the ${andList(apps)} app${apps.length > 1 ? 's' : ''}, not the ${f.app ?? 'this'} app`, need: null, needNot: null,
  };
}
function toolsClause(tools, f) {
  const what = `the ${listText(tools)} tool${tools.length > 1 ? 's' : ''}`;
  return { known: true, selector: true, inWhat: true, what, text: `the tool is one of ${listText(tools)}`, pass: `${f.tool ?? 'the tool'} is one of ${listText(tools)}`,
    fail: `this rule is about ${what}, not ${f.tool ?? 'this tool'}`, need: null, needNot: null };
}

// ---- scope parts ----------------------------------------------------------------------------------------------------
function describeScope(part, s, f) {
  if (part === 'principal') {
    const ent = entityScope(s);
    if (s.op === 'in' && ent?.type === 'Group') return { ...groupClause(ent.id, f, 'the person'), text: `people in the ${ent.id} group`, who: `people in the ${ent.id} group`, groups: [ent.id] };
    if (s.op === '==' && ent?.type === 'User') {
      return { known: true, text: `the user ${ent.id}`, who: `the user ${ent.id}`, groups: [], pass: `${f.name ?? 'the person'} is ${ent.id}`, fail: `${f.name ?? 'the person'} is not ${ent.id}`, need: `the person were ${ent.id}`, needNot: null };
    }
    return UNKNOWN;
  }
  if (part === 'action') {
    const ids = s.op === '==' && s.entity?.type === 'Action' ? [s.entity.id] : s.op === 'in' && Array.isArray(s.entities) && s.entities.every((x) => x.type === 'Action') ? s.entities.map((x) => x.id) : null;
    if (!ids || !ids.length || ids.some((i) => !Object.values(ACTION).includes(i))) return UNKNOWN;
    const att = ids.includes(ACTION.attended);
    const unatt = ids.includes(ACTION.unattended);
    if (att && unatt) return { known: true, attended: 'both', text: 'calls (attended or unattended)', pass: '', fail: '', need: null, needNot: null };
    if (att) {
      return { known: true, attended: 'attended', text: 'attended calls', pass: 'the call is attended', fail: 'the call is unattended, and this rule only covers attended calls', need: 'the call were attended', needNot: 'the call were unattended', cf: { kind: 'attended', value: true }, cfNot: { kind: 'attended', value: false } };
    }
    return {
      known: true, attended: 'unattended', text: 'unattended calls', pass: `the call is unattended (${f.agent ?? 'an agent'} acts for ${f.name ?? 'the person'})`,
      fail: 'the call is attended, and this rule only covers unattended calls (an agent acting for someone)', need: 'an agent made the call', needNot: 'the call were attended', cf: { kind: 'attended', value: false }, cfNot: { kind: 'attended', value: true },
    };
  }
  if (part === 'resource') {
    const ent = entityScope(s);
    if (s.op === '==' && ent?.type === 'Tool') {
      return { known: true, selector: true, inWhat: true, what: `the ${ent.id} tool`, text: `the ${ent.id} tool`, pass: '', fail: `this rule is about the ${ent.id} tool, not ${f.tool ?? 'this tool'}`, need: null, needNot: null };
    }
    return UNKNOWN;
  }
  return UNKNOWN;
}

/** Put one clause (from clausesOf) into words. `f` holds the facts of a real request; without it only `text` is meaningful. */
export function describeClause(clause, f = {}) {
  const d = clause.scope ? describeScope(clause.part, clause.scope, f) : describeExpr(clause.expr, f);
  return d.known ? { ...d, part: clause.part } : { known: false, part: clause.part };
}

/** The Cedar text of one condition (for a clause we cannot put into words). Never throws. */
export function rawClauseText(cedar, clause) {
  try {
    if (clause.scope) return `${clause.part} ${JSON.stringify(clause.scope)}`;
    const t = cedar.policyToText({ effect: 'permit', principal: { op: 'All' }, action: { op: 'All' }, resource: { op: 'All' }, conditions: [{ kind: clause.part, body: clause.expr }] });
    const m = /^permit\(principal, action, resource\) (?:when|unless) \{ ([\s\S]*) \};$/.exec(t.text ?? '');
    return m ? m[1] : 'a condition written in Cedar';
  } catch { return 'a condition written in Cedar'; }
}

/** The permit-only policies Cedar evaluates to learn which parts of a policy hold. Keys are "<id>|<part>". */
export function derivedFor(id, json) {
  const mk = (over) => ({ effect: 'permit', principal: { op: 'All' }, action: { op: 'All' }, resource: { op: 'All' }, conditions: [], ...over });
  const out = { [`${id}|whole`]: { ...json, effect: 'permit', annotations: {} } };
  for (const c of clausesOf(json)) out[`${id}|${c.key}`] = c.scope ? mk({ [c.part]: c.scope }) : mk({ conditions: [{ kind: c.part, body: c.expr }] });
  return out;
}

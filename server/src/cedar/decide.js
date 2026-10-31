// decide({ policySet, claims, toolCall }): pure and synchronous after init(). Never throws on bad request input;
// anything it cannot evaluate or even read is a deny with rule "invalid-claims", "invalid-request" or "error" (fail closed).
import { engine } from './engine.js';
import { mapClaims, plainJsonProblem } from './mapClaims.js';

const DEFAULT_DENY = 'default-deny';
const ACTIONS = new Set(['mcp:Invoke', 'mcp:InvokeUnattended']);

function result({ decision, rule, rules = [], overridden = [], reason, problems = [], subject = null, actor = null, started }) {
  const latency_ms = Number((performance.now() - started).toFixed(3));
  return {
    decision,
    rule,
    rules,
    overridden,
    reason,
    problems,
    // Everything a trace-envelope hop needs. The caller adds trace_id/span_id/ts; no trace library is imported here.
    trace: {
      product: 'cedar',
      engine_version: engine().engineVersion,
      hop: 'policy:ai-policy',
      subject,
      actor,
      decision: { result: decision, rule, reason },
      latency_ms,
    },
  };
}

// Last resort: built by hand so nothing here can depend on the input or on engine state.
function failClosed(started) {
  let engine_version = null;
  try { engine_version = engine().engineVersion; } catch { /* engine not initialised */ }
  const reason = 'The request could not be read, so it was denied';
  return {
    decision: 'deny',
    rule: 'error',
    rules: [],
    overridden: [],
    reason,
    problems: ['input could not be read'],
    trace: {
      product: 'cedar',
      engine_version,
      hop: 'policy:ai-policy',
      subject: null,
      actor: null,
      decision: { result: 'deny', rule: 'error', reason },
      latency_ms: Number((performance.now() - started).toFixed(3)),
    },
  };
}

export function decide(input) {
  const started = performance.now();
  try {
    return decideUnsafe(input, started);
  } catch {
    return failClosed(started);
  }
}

function decideUnsafe({ policySet, claims, toolCall }, started) {
  const { cedar, schema: defaultSchema } = engine();
  const schema = policySet?.schema ?? defaultSchema; // a vertical pack's own schema rides on its policy set
  const early = (rule, reason, problems, subject) => result({ decision: 'deny', rule, reason, problems, subject, started });

  const mapped = mapClaims(claims);
  if (!mapped.ok) return early('invalid-claims', 'Claims were rejected before evaluation', mapped.problems);
  const subject = mapped.principal.id;
  const actor = mapped.token.actor ?? null;

  const t = toolCall;
  if (!policySet?.staticPolicies || t === null || typeof t !== 'object' || typeof t.tool !== 'string' || !t.tool || typeof t.app !== 'string') {
    return early('invalid-request', 'Tool call or policy set is malformed', ['toolCall needs { tool, app }'], subject);
  }
  const action = t.action ?? 'mcp:Invoke';
  if (!ACTIONS.has(action)) return early('invalid-request', 'Unknown action', [`action must be one of ${[...ACTIONS].join(', ')}`], subject);

  // pinnedHash has no default: a caller that forgets it must not silently switch the S05 rug-pull check off.
  if (typeof t.pinnedHash !== 'string' || !t.pinnedHash) {
    return early('invalid-request', 'pinnedHash is required to check the tool has not changed', ['toolCall needs a non-empty string pinnedHash'], subject);
  }
  const argsProblem = plainJsonProblem(t.args ?? {}, 'args');
  if (argsProblem) return early('invalid-request', 'Tool arguments are not plain JSON', [argsProblem], subject);

  const observed = t.observedHash ?? '';
  const context = {
    app: t.app,
    args: t.args ?? {},
    token: mapped.token,
    approval_count: t.approvalCount ?? 0,
    pinnedHash: t.pinnedHash,
    observedHash: observed,
  };
  const request = {
    principal: mapped.principal,
    action: { type: 'Action', id: action },
    resource: { type: 'Tool', id: t.tool },
    context,
    schema,
    validateRequest: true,
    // t.resource: attributes of the tool call's target (a pack's repo / classification), computed by the server, never by the caller.
    entities: [...mapped.entities, { uid: { type: 'Tool', id: t.tool }, attrs: t.resource ?? {}, parents: [] }],
  };
  const run = (staticPolicies) =>
    cedar.isAuthorized({ ...request, policies: { staticPolicies, templates: {}, templateLinks: [] } });

  let r;
  try {
    r = run(policySet.staticPolicies);
  } catch (e) {
    return early('invalid-request', 'Evaluation failed', ['the engine rejected the request'], subject);
  }
  if (r.type !== 'success') {
    return early('invalid-request', 'Request does not fit the schema', r.errors.map((e) => String(e.message).slice(0, 200)), subject);
  }

  const allowed = r.response.decision === 'allow';
  const rules = r.response.diagnostics.reason;
  // A forbid without @approvers is final; the headline names the first such forbid even when an approvable one also fired.
  const approvable = (id) => String(policySet.annotations[id]?.approvers ?? '').trim() !== '';
  const rule = (allowed ? undefined : rules.find((id) => !approvable(id))) ?? rules[0] ?? DEFAULT_DENY;
  const reason = rules.length
    ? policySet.annotations[rule]?.reason ?? rule
    : 'No policy permits this request (default deny)';

  // Cedar lists only the winning forbid. Re-run with forbids removed to show the permits it overrode.
  let overridden = [];
  if (!allowed && rules.length) {
    const permitsOnly = Object.fromEntries(Object.entries(policySet.staticPolicies).filter(([id]) => policySet.effects[id] === 'permit'));
    const c = run(permitsOnly);
    if (c.type === 'success' && c.response.decision === 'allow') overridden = c.response.diagnostics.reason;
  }
  return result({ decision: allowed ? 'allow' : 'deny', rule, rules, overridden, reason, subject, actor, started });
}

// The policy enforcement point. enforce() is the single path for POST /api/tools/call and POST /mcp.
// It validates arguments, builds pinnedHash/observedHash, calls Cedar through decide(), and turns the answer into
// allow (tool runs), deny (policy id + @reason) or hold (an approval record naming the policy's @approvers).
// Free-text such as a justification is never an input to decide().
import { decide } from './cedar/index.js';
import { argProblems } from './mcp/backend.js';

export const approversOf = (policySet, id) =>
  String(policySet?.annotations?.[id]?.approvers ?? '').split(/[\s,]+/).filter(Boolean);

// A denial becomes a hold only when every forbid that fired names @approvers (so an approval could clear them all).
export function classify(d, policySet) {
  if (d.decision === 'allow') return 'allow';
  const rules = d.rules ?? [];
  return rules.length > 0 && rules.every((r) => approversOf(policySet, r).length > 0) ? 'hold' : 'deny';
}

// Cedar's schema only knows args.amount, so only that crosses over. Argument types were already checked against the tool schema.
export function evaluate({ policySet, claims, tool, app, args, pinnedHash, observedHash, approvalCount = 0, resource }) {
  const action = claims?.act ? 'mcp:InvokeUnattended' : 'mcp:Invoke';
  const cedarArgs = args && Object.hasOwn(args, 'amount') ? { amount: args.amount } : {};
  return decide({ policySet, claims, toolCall: { tool, app, action, args: cedarArgs, pinnedHash, observedHash, approvalCount, ...(resource ? { resource } : {}) } });
}

// attribution (a pack option): every trace event and result also names the tool and who it was for (user sub + agent act.sub).
export function createPep({ backend, store, approvals, tracer, audit, now, attribution = false }) {
  const subjectOf = (claims) => (typeof claims?.sub === 'string' && claims.sub ? claims.sub : null);
  const actorOf = (claims) => (typeof claims?.act?.sub === 'string' ? { sub: claims.act.sub } : null);
  const auditRow = (extra) => audit.write(extra);
  // With attribution on, each event also names the tool (an app field beside the envelope: see trace/hops.js).
  const emit = (tp, o, tool) => tracer.emit(tp, attribution ? { ...o, tool } : o);
  const who = (claims, tool) => (attribution ? { attribution: { user: subjectOf(claims), agent: actorOf(claims)?.sub ?? null, tool } } : {});

  function run(claims, tool, args, d, tp, source, extra = {}) {
    const t0 = performance.now();
    const result = backend.callTool(tool, args);
    ({ traceparent: tp } = emit(tp, { hop: 'tool', subject: subjectOf(claims), actor: actorOf(claims),
      decision: { result: 'allow', rule: d.rule, reason: `${tool} ran` }, latency_ms: performance.now() - t0 }, tool));
    return { result, tp, ...extra };
  }

  function enforce({ claims, tool, args = {}, source, traceparent, justification }) {
    const t0 = performance.now();
    const subject = subjectOf(claims);
    const actor = actorOf(claims);
    let tp = traceparent;
    const finish = (outcome, rule, reason, body = {}) => {
      ({ traceparent: tp } = emit(tp, { hop: 'pep', subject, actor, decision: { result: outcome, rule, reason }, latency_ms: performance.now() - t0 }, tool));
      auditRow({ kind: 'tool_call', source, sub: subject, actor: actor?.sub ?? null, tool, outcome, rule, approval_id: body.approvalId ?? null, trace_id: tp.split('-')[1] });
      return { outcome, rule, reason, ...body, ...who(claims, tool), traceparent: tp, trace_id: tp.split('-')[1] };
    };

    const def = backend.tool(tool);
    if (!def) return finish('deny', 'unknown-tool', 'No such tool', { rules: [], overridden: [] });
    const problems = argProblems(def.inputSchema, args);
    if (problems.length) return finish('deny', 'invalid-arguments', 'Tool arguments are not valid', { problems, rules: [], overridden: [] });

    const policySet = store.activeSet();
    const resource = backend.resourceAttrs(tool, args);
    const d = evaluate({ policySet, claims, tool, app: def.app, args, pinnedHash: backend.pinnedHash(tool), observedHash: backend.observedHash(tool), resource });
    ({ traceparent: tp } = emit(tp, { product: d.trace.product, hop: d.trace.hop, subject, actor,
      decision: { result: classify(d, policySet), rule: d.rule, reason: d.reason }, latency_ms: d.trace.latency_ms }, tool));
    const body = { rules: d.rules, overridden: d.overridden, problems: d.problems, app: def.app };

    const kind = classify(d, policySet);
    if (kind === 'allow') {
      const ran = run(claims, tool, args, d, tp, source);
      tp = ran.tp;
      return finish('allow', d.rule, d.reason, { ...body, result: ran.result });
    }
    // A hold is only honest if an approval could end in allow: re-run with approvalCount 1 first, else deny with the original reason.
    const approvable = kind === 'hold' && evaluate({ policySet, claims, tool, app: def.app, args,
      pinnedHash: backend.pinnedHash(tool), observedHash: backend.observedHash(tool), approvalCount: 1, resource }).decision === 'allow';
    if (approvable) {
      const approvers = [...new Set(d.rules.flatMap((r) => approversOf(policySet, r)))];
      const { record } = approvals.create({ claims, tool, app: def.app, args, policy: { rule: d.rule, reason: d.reason }, approvers, justification, traceparent: tp });
      const out = finish('hold', d.rule, d.reason, { ...body, approvalId: record.id, approvers, expiresAt: new Date(record.expiresAtMs).toISOString() });
      record.traceparent = out.traceparent;
      return out;
    }
    return finish('deny', d.rule, d.reason, body);
  }

  // Approver said yes (or no). Re-evaluate against the current policies with approval_count 1 and run the tool at most once.
  function resolve(record, approver, approve) {
    const t0 = performance.now();
    let tp = record.traceparent;
    const claims = record.claims;
    const subject = subjectOf(claims);
    const actor = actorOf(claims);
    record.decidedBy = approver.sub;
    record.decidedAt = new Date(now()).toISOString();
    let outcome;
    if (!approve) {
      record.status = 'denied';
      outcome = { decision: 'deny', rule: record.policy.rule, reason: `Denied by ${approver.sub}`, executed: false };
    } else {
      record.status = 'approved';
      const policySet = store.activeSet();
      const d = evaluate({ policySet, claims, tool: record.tool, app: record.app, args: record.args,
        pinnedHash: backend.pinnedHash(record.tool), observedHash: backend.observedHash(record.tool), approvalCount: 1,
        resource: backend.resourceAttrs(record.tool, record.args) });
      ({ traceparent: tp } = emit(tp, { product: d.trace.product, hop: d.trace.hop, subject, actor,
        decision: { result: classify(d, policySet), rule: d.rule, reason: d.reason }, latency_ms: d.trace.latency_ms }, record.tool));
      if (d.decision === 'allow') {
        const ran = run(claims, record.tool, record.args, d, tp, 'approval');
        tp = ran.tp;
        outcome = { decision: 'allow', rule: d.rule, reason: d.reason, executed: true, result: ran.result };
      } else {
        outcome = { decision: 'deny', rule: d.rule, reason: d.reason, executed: false };
      }
    }
    record.outcome = outcome;
    ({ traceparent: tp } = emit(tp, { hop: 'approval', subject, actor,
      decision: { result: outcome.decision, rule: outcome.rule, reason: `${approve ? 'approved' : 'denied'} by ${approver.sub}` }, latency_ms: performance.now() - t0 }, record.tool));
    record.traceparent = tp;
    auditRow({ kind: 'approval', approval_id: record.id, sub: subject, tool: record.tool, approver: approver.sub, approved: approve, outcome: outcome.decision, rule: outcome.rule, executed: outcome.executed, trace_id: tp.split('-')[1] });
    return record;
  }

  return { enforce, resolve };
}

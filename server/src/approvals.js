// Human-in-the-loop queue. In memory, single tenant. Expiry is lazy and uses the injected clock.
// The stored claims snapshot (verified claims, never a token) is used to re-evaluate the call after approval; it is not in the public view.
import { randomUUID } from 'node:crypto';

export function createApprovals({ now, ttlMs, onExpire = () => {} }) {
  const items = new Map();

  function sweep() {
    for (const r of items.values()) {
      if (r.status === 'pending' && r.expiresAtMs <= now()) {
        r.status = 'expired';
        r.decidedAt = new Date(now()).toISOString();
        r.outcome = { decision: 'deny', rule: 'approval-expired', reason: 'No approver answered in time, so the call stays denied', executed: false };
        try { onExpire(r); } catch { /* an observer must not break the queue */ }
      }
    }
  }

  const view = (r) => ({
    id: r.id, status: r.status, tool: r.tool, app: r.app, args: r.args,
    requester: { sub: r.claims.sub, actor: r.claims.act?.sub ?? null },
    policy: r.policy, approvers: r.approvers, justification: r.justification,
    createdAt: r.createdAt, expiresAt: new Date(r.expiresAtMs).toISOString(),
    decidedBy: r.decidedBy ?? null, decidedAt: r.decidedAt ?? null, outcome: r.outcome ?? null, explanation: r.explanation ?? null,
  });

  return {
    view,
    create({ claims, tool, app, args, policy, approvers, justification, traceparent }) {
      sweep();
      const key = `${claims.sub}|${tool}|${JSON.stringify(args)}`;
      for (const r of items.values()) if (r.status === 'pending' && r.key === key) return { record: r, created: false };
      const record = {
        id: randomUUID(), key, status: 'pending', claims, tool, app, args, policy, approvers,
        justification: typeof justification === 'string' ? justification.slice(0, 500) : null, // shown to the approver, never evaluated
        createdAt: new Date(now()).toISOString(), expiresAtMs: now() + ttlMs, traceparent,
      };
      items.set(record.id, record);
      return { record, created: true };
    },
    get(id) { sweep(); return items.get(id) ?? null; },
    list() { sweep(); return [...items.values()].reverse(); },
    clear() { items.clear(); },
  };
}

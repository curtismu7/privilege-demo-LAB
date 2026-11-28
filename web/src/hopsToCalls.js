// The run's hops (the /api/trace events of one trace) as the diagram kit's call data, one entry per
// EDGE the hop's diagram box pair touches. This lab's trace is event-based: each event carries the
// decision (result, rule, reason) and latency, not a raw wire transcript, so the call shows what the
// product recorded. `edges` is the loaded diagram's edge list (source/target pairs).
const HOP_NODE = { auth: "idp", pep: "pep", tool: "tool", approval: "approver" };
const GLOSS = { auth: "Sign-in check", pep: "Policy decision (PEP/PDP)", tool: "Tool ran", approval: "A person answered" };

export function hopsToCalls(events, edges) {
  if (!Array.isArray(events) || !Array.isArray(edges)) return [];
  const byPair = new Map();
  edges.forEach((e, i) => { const k = `${e.source}>${e.target}`; (byPair.get(k) ?? byPair.set(k, []).get(k)).push(i); });
  const calls = [];
  for (const ev of events) {
    const from = HOP_NODE[ev.hop];
    if (!from) continue;
    // A hop lands on every edge leaving its box (the diagram fans the decision out); each such edge shows the call.
    for (const [k, idxs] of byPair) {
      const [a] = k.split(">");
      if (a !== from) continue;
      for (const i of idxs) {
        calls.push({ edgeIndex: i, hop: {
          title: GLOSS[ev.hop] ?? ev.hop,
          fact: `${ev.decision?.result ?? "?"}: ${ev.decision?.rule ?? ""}`,
          verdict: ev.decision?.result === "permit" || ev.decision?.result === "allow" ? "ok" : ev.decision?.result === "deny" ? "deny" : "held",
          request: { hop: ev.hop, subject: ev.subject ?? null, actor: ev.actor?.sub ?? null, tool: ev.tool ?? null, latency_ms: ev.latency_ms ?? null },
          response: { result: ev.decision?.result ?? null, rule: ev.decision?.rule ?? null, reason: ev.decision?.reason ?? null },
        } });
      }
    }
  }
  return calls;
}

/** Merge the calls onto a diagram-studio steps/edges document: each edge with a call gets `hop` on its step's edge copy. */
export function withHops(diagram, calls) {
  if (!calls.length) return diagram;
  const byIndex = new Map();
  for (const c of calls) byIndex.set(c.edgeIndex, c.hop);
  return {
    ...diagram,
    edges: diagram.edges.map((e, i) => (byIndex.has(i) ? { ...e, hop: byIndex.get(i) } : e)),
  };
}

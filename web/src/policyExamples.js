// "Example:" lines on the AI Policies page. They are never typed: the pool is real answers from POST /api/decide-test (the group x tool
// grid, the pack's cases and the Try-this requests), and a policy gets the answers its id decided (or, failing that, one it overrode).
const WORD = { allow: "Allow", deny: "Deny", hold: "Hold" };

export const outcomeWord = (outcome) => WORD[outcome] ?? outcome;

/**
 * pool: [{ label, outcome, rule, overridden? }] in the order to prefer. Returns up to `max` examples decided by `id`, one per outcome,
 * each { ...entry, relation: "decides" }; if none, one entry whose `overridden` names `id` ({ relation: "overridden" }); else [].
 */
export function examplesFor(id, pool, max = 2) {
  const seen = new Set();
  const out = [];
  for (const r of pool) {
    if (r.rule !== id || seen.has(r.outcome)) continue;
    seen.add(r.outcome);
    out.push({ ...r, relation: "decides" });
    if (out.length >= max) break;
  }
  if (out.length) return out;
  const over = pool.find((r) => Array.isArray(r.overridden) && r.overridden.includes(id));
  return over ? [{ ...over, relation: "overridden" }] : [];
}

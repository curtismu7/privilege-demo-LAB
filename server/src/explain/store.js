// Per-workspace ring of explanations keyed by the span id of the hop they explain (pep, approval). Same cap as the trace sink,
// so an explanation never outlives the event it belongs to by much. The trace events themselves carry no explanation field.
export function createExplanationStore({ size = 500 } = {}) {
  const map = new Map();
  return {
    put(spanId, explanation) {
      if (!spanId || !explanation) return;
      map.delete(spanId);
      map.set(spanId, explanation);
      while (map.size > size) map.delete(map.keys().next().value);
    },
    get: (spanId) => map.get(spanId) ?? null,
    clear: () => map.clear(),
    size: () => map.size,
  };
}

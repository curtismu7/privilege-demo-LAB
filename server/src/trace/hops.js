// App wrapper over the copied envelope module: one emit() per hop. The traceparent returned by one hop is passed to the next,
// so a request reads as one chain. An event that trips the credential guard is stored without subject/actor rather than dropped.
import { makeEvent, validateEvent } from './envelope.js';

export function createTracer({ sink, now = () => Date.now() }) {
  return {
    sink,
    // `tool` (optional) is an app field kept beside the envelope event (the envelope module is a copy and stays unchanged).
    emit(traceparent, { product = 'privilege-demo', hop, subject = null, actor = null, decision, latency_ms = 0, tool }) {
      const base = { traceparent, product, hop, subject, actor, decision, latency_ms, now: now() };
      let made = makeEvent(base);
      if (validateEvent(made.event).length) {
        made = makeEvent({ ...base, subject: null, actor: null, decision: { ...decision, reason: 'details withheld by the credential guard' } });
        if (validateEvent(made.event).length) return { traceparent: made.traceparent };
      }
      const kept = typeof tool === 'string' && /^[a-z0-9._-]{1,80}$/.test(tool) ? { ...made.event, tool } : made.event;
      sink.push(kept);
      return { traceparent: made.traceparent, event: kept };
    },
  };
}

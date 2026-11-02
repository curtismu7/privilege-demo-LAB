// The explainer the PEP, the approval queue and the routes share. It is optional everywhere (no explainer = today's behaviour),
// and every entry point catches its own errors: an explanation can fail, a decision never changes because of it.
import { engine } from '../cedar/engine.js';
import { explainAnswer, explainBefore, explainDecision } from './decision.js';
import { meaningOf } from './meaning.js';
import { createNamer, safe } from './names.js';

export { createExplanationStore } from './store.js';

const FAILED = (outcome) => ({ v: 1, error: true, outcome, text: 'An explanation could not be built. The decision above is not affected.' });

export function createExplainer({ pack, customer, mode }) {
  const namer = createNamer({ pack, customer, mode });
  const deps = { namer };
  const guard = (outcome, fn) => { try { return fn(); } catch { return FAILED(outcome); } };
  const cache = new Map(); // policy text -> meaning (the editor asks again for the same text on every keystroke pause)

  return {
    // Every rule-evaluated call (tool call, Test a request, an approval recheck). `outcome` is the PEP's final outcome when known.
    forCall: (ctx) => guard(ctx?.outcome ?? 'deny', () => explainDecision(ctx, deps)),
    // The arguments or the tool were refused before any rule was checked.
    forBefore: (ctx) => guard('deny', () => explainBefore(ctx, deps)),
    // An approver said no, or nobody answered.
    forAnswer: (ctx) => guard('deny', () => explainAnswer(ctx, deps)),
    // The meaning of a policy, from its saved text. Cached by text; never throws.
    meaning(row) {
      const key = `${row.state}|${row.id}|${row.text}|${mode()}`;
      const hit = cache.get(key);
      if (hit) return hit;
      let m;
      try { m = meaningOf(row, namer); } catch { m = { id: safe(row.id, 100), state: row.state, explainedFrom: 'text', does: 'This rule could not be put into words. Its Cedar text is shown below.', source: row.text ?? '' }; }
      if (cache.size > 200) cache.clear();
      cache.set(key, m);
      return m;
    },
    engineVersion: () => engine().engineVersion,
  };
}

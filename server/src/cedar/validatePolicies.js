// Strict validation of policy text against the schema. Never throws; returns problems.
// Input is { policyId: cedarText }. One static policy per entry. No templates in v1.
import { engine, resetEngine } from './engine.js';

export const LIMITS = { maxPolicies: 50, maxPolicyBytes: 4096, maxTotalBytes: 65536, maxNesting: 32, maxDots: 64 };
const ID_RE = /^[A-Za-z0-9._:-]{1,100}$/;

function nesting(text) {
  let d = 0;
  let max = 0;
  for (const ch of text) {
    if (ch === '(' || ch === '[' || ch === '{') max = Math.max(max, ++d);
    else if (ch === ')' || ch === ']' || ch === '}') d = Math.max(0, d - 1);
  }
  return max;
}

const msg = (e) => String(e?.message ?? e?.error?.message ?? e).slice(0, 300);

// opts.schema: a pack's own Cedar schema text (default: the generic schema). It travels with the returned policySet so decide() uses the same one.
export function validatePolicies(policies, opts = {}) {
  const problems = [];
  const bad = (policyId, message) => problems.push({ policyId, message });
  const result = () => ({ ok: problems.length === 0, problems, policySet: problems.length ? null : policySet });
  const policySet = { staticPolicies: {}, annotations: {}, effects: {}, ...(opts.schema ? { schema: opts.schema } : {}) };
  try {
    const { cedar, schema: defaultSchema } = engine();
    const schema = opts.schema ?? defaultSchema;
    if (policies === null || typeof policies !== 'object' || Array.isArray(policies)) {
      bad(null, 'policies must be an object of { id: text }');
      return result();
    }
    const ids = Object.keys(policies);
    if (ids.length === 0) bad(null, 'no policies given');
    if (ids.length > LIMITS.maxPolicies) {
      bad(null, `too many policies (max ${LIMITS.maxPolicies})`);
      return result();
    }
    let total = 0;
    for (const id of ids) {
      const text = policies[id];
      if (!ID_RE.test(id)) { bad(id, 'policy id must match [A-Za-z0-9._:-]{1,100}'); continue; }
      if (typeof text !== 'string') { bad(id, 'policy text must be a string'); continue; }
      const bytes = Buffer.byteLength(text);
      total += bytes;
      if (bytes > LIMITS.maxPolicyBytes) { bad(id, `policy text too large (max ${LIMITS.maxPolicyBytes} bytes)`); continue; }
      if (nesting(text) > LIMITS.maxNesting) { bad(id, `policy nested too deeply (max ${LIMITS.maxNesting})`); continue; }
      if (text.split('.').length - 1 > LIMITS.maxDots) { bad(id, `too many "." accessors (max ${LIMITS.maxDots})`); continue; }
      policySet.staticPolicies[id] = text;
    }
    if (total > LIMITS.maxTotalBytes) bad(null, `total policy text too large (max ${LIMITS.maxTotalBytes} bytes)`);
    if (problems.length) return result();

    // Parse each alone so a problem is attributed to its policy. Templates and multi-policy text fail here.
    for (const [id, text] of Object.entries(policySet.staticPolicies)) {
      try {
        const r = cedar.policyToJson(text);
        if (r.type !== 'success') { for (const e of r.errors) bad(id, msg(e)); continue; }
        const ann = r.json.annotations ?? {};
        if (ann.id !== undefined && ann.id !== id) { bad(id, `@id annotation "${ann.id}" does not match policy id`); continue; }
        policySet.annotations[id] = ann;
        policySet.effects[id] = r.json.effect;
      } catch (e) {
        bad(id, `could not parse: ${msg(e)}`);
        try { resetEngine(); } catch { /* next call reports it */ }
      }
    }
    if (problems.length) return result();

    const v = cedar.validate({
      validationSettings: { mode: 'strict' },
      schema,
      policies: { staticPolicies: policySet.staticPolicies, templates: {}, templateLinks: [] },
    });
    if (v.type !== 'success') for (const e of v.errors ?? []) bad(null, msg(e));
    for (const e of v.validationErrors ?? []) bad(e.policyId ?? null, msg(e.error ?? e));
    for (const w of v.validationWarnings ?? []) bad(w.policyId ?? null, msg(w.error ?? w));
  } catch (e) {
    bad(null, `validation failed: ${msg(e)}`);
    try { resetEngine(); } catch { /* next call reports it */ }
  }
  return result();
}

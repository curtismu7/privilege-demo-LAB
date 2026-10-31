// One-time init of the pinned Cedar wasm engine and the schema. Everything else is synchronous after this.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = (p) => new URL(p, import.meta.url);

let state = null;

export function init() {
  if (state) return state;
  const cedar = require('@cedar-policy/cedar-wasm/nodejs');
  const schema = readFileSync(here('./schema.cedarschema'), 'utf8');
  state = { cedar, schema, engineVersion: cedar.getCedarVersion() };
  return state;
}

// A wasm trap leaves the module's memory corrupted for the life of the process. Drop it so the next init() gets a fresh instance.
export function resetEngine() {
  state = null;
  for (const k of Object.keys(require.cache)) if (k.includes('cedar-wasm')) delete require.cache[k];
  return init();
}

export function engine() {
  if (!state) throw new Error('privilege-demo: call init() once before use');
  return state;
}

// Reads the shipped .cedar files into { policyId: text }. The id comes from the @id annotation.
// `dir` (a file URL ending in /) defaults to the generic pack's folder; a vertical pack passes its own.
export function loadShippedPolicies(dir = here('./policies/')) {
  const out = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.cedar')).sort()) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    const m = /@id\("([^"]+)"\)/.exec(text);
    if (!m) throw new Error(`policy file ${f} has no @id annotation`);
    out[m[1]] = text;
  }
  return out;
}

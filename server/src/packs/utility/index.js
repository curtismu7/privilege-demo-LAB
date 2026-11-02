// The "utility / NERC CIP-style" pack: a vertical built from a generic utility use case. No customer is named anywhere in
// this repo. The four groups, the people and the rules are INVENTED for the demo, and every backend is a MOCK.
// Policies are .cedar files in ./policies (data, each with an @reason); personas and screen wording are in pack.json.
import { readFileSync } from 'node:fs';
import { loadShippedPolicies } from '../../cedar/engine.js';
import { UTILITY_TOOLS } from './tools.js';

const here = (p) => new URL(p, import.meta.url);
const data = JSON.parse(readFileSync(here('./pack.json'), 'utf8'));
const { personas, argDefaults, scenarios, tryThis, groups, notice, agent, diagram, approvalsHint } = data;
const GENERIC_POLICIES = new URL('../../cedar/policies/', import.meta.url);

export default {
  id: data.id,
  label: data.label,
  personas,
  agent,
  tools: UTILITY_TOOLS,
  schema: readFileSync(here('./schema.cedarschema'), 'utf8'),
  // The rug-pull pin is the one generic policy this pack keeps (same id, same text, so story S05 still names a real policy).
  shippedPolicies: () => {
    const pin = loadShippedPolicies(GENERIC_POLICIES)['s05-rugpull-pin'];
    return { 's05-rugpull-pin': pin, ...loadShippedPolicies(here('./policies/')) };
  },
  // Trace events and results also say which tool was called and for whom (user sub + agent act.sub).
  attribution: true,
  web: {
    notice,
    groups,
    toolNames: UTILITY_TOOLS.map((t) => t.name),
    argDefaults,
    scenarios,
    tryThis,
    diagram,
    approvalsHint,
    testUsers: Object.entries(personas).map(([id, p]) => ({ id, label: `${p.name} (${p.role})`, groups: p.claims.groups })),
    personas: Object.entries(personas).map(([id, p]) => ({ id, name: p.name, role: p.role, line: p.line, admin: p.admin === true })),
  },
};

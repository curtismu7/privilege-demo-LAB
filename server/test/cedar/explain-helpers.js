// Shared by the explanation tests: a world (pack, policy set, backend, explainer) and an independent PEP-outcome oracle.
import { init, validatePolicies, decide } from '../../src/cedar/index.js';
import { evaluate, classify } from '../../src/pep.js';
import { getPack } from '../../src/packs/index.js';
import { createBackend } from '../../src/mcp/backend.js';
import { createExplainer } from '../../src/explain/index.js';

init();
export const BASE = { client_id: 'privilege-demo-web', scope: 'tools:invoke' };

export function makeWorld(packId = 'generic', { mode = 'mock', cast = {}, policies } = {}) {
  const pack = getPack(packId);
  const compiled = validatePolicies(policies ?? pack.shippedPolicies(), { schema: pack.schema });
  if (!compiled.ok) throw new Error(`policies invalid: ${JSON.stringify(compiled.problems)}`);
  const ps = compiled.policySet;
  const be = createBackend({ tools: pack.tools });
  const ex = createExplainer({ pack, customer: { config: { cast } }, mode: () => mode });
  const input = (claims, tool, args = {}, over = {}) => ({
    policySet: over.policySet ?? ps, claims, tool, app: be.tool(tool).app, args, resource: be.resourceAttrs(tool, args),
    pinnedHash: be.pinnedHash(tool), observedHash: over.drift ? 'drifted' : be.observedHash(tool), approvalCount: over.approvalCount ?? 0, source: over.source ?? 'session',
  });
  const explain = (claims, tool, args, over = {}) => ex.forCall({ ...input(claims, tool, args, over), ...(over.extra ?? {}) });
  // What the PEP answers, worked out here from decide() alone (the same rule as pep.js: a hold only if one approval would lead to allow).
  const pepOutcome = (claims, tool, args, over = {}) => {
    const i = input(claims, tool, args, over);
    const d = evaluate(i);
    if (d.decision === 'allow') return 'allow';
    return classify(d, i.policySet) === 'hold' && evaluate({ ...i, approvalCount: 1 }).decision === 'allow' ? 'hold' : 'deny';
  };
  // Independent oracle for "did this rule apply": decide() over a policy set holding only that rule.
  const alone = new Map();
  const appliedAlone = (id, claims, tool, args, over = {}) => {
    const key = `${id}|${over.policySet ? 'x' : ''}`;
    if (!alone.has(key)) {
      const src = (over.policySet ?? ps).staticPolicies[id];
      alone.set(key, validatePolicies({ [id]: src }, { schema: pack.schema }).policySet);
    }
    const i = { ...input(claims, tool, args, over), policySet: alone.get(key) };
    return decide({ policySet: i.policySet, claims, toolCall: { tool, app: i.app, action: claims.act ? 'mcp:InvokeUnattended' : 'mcp:Invoke', args: args && Object.hasOwn(args, 'amount') ? { amount: args.amount } : {},
      pinnedHash: i.pinnedHash, observedHash: i.observedHash, approvalCount: i.approvalCount, resource: i.resource } }).rules.includes(id);
  };
  return { pack, ps, be, ex, input, explain, pepOutcome, appliedAlone };
}

export const person = (sub, groups, extra = {}) => ({ sub, groups, ...BASE, ...extra });
export const withAgent = (claims, agent = 'dot') => ({ ...claims, act: { sub: agent } });

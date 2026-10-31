import { init, loadShippedPolicies, validatePolicies, decide } from '../../src/cedar/index.js';

init();
const v = validatePolicies(loadShippedPolicies());
if (!v.ok) throw new Error('shipped policies invalid: ' + JSON.stringify(v.problems));
export const policySet = v.policySet;

export const mary = { sub: 'mary', groups: ['analysts'], scope: 'tools:invoke', client_id: 'dot' };
export const fin = { sub: 'fin1', groups: ['analysts', 'finance'], scope: 'tools:invoke payments:write', client_id: 'dot' };
export const ta = { sub: 'ta1', groups: ['travel-agents'], scope: 'tools:invoke', client_id: 'dot', act: { sub: 'dot' } };

const apps = { search_docs: 'search', create_ticket: 'ticketing', pay_invoice: 'payments', book_fare: 'booking' };
export const ask = (claims, tool, extra = {}, ps = policySet) =>
  decide({ policySet: ps, claims, toolCall: { tool, app: apps[tool], pinnedHash: 'h', observedHash: 'h', ...extra } });

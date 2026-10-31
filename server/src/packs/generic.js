// The original demo as a pack: Mark, Mary, Priya, Dana; search_flights, create_ticket, pay_invoice, book_fare; six policies.
import { PERSONAS, AGENT } from '../auth/personas.js';
import { GENERIC_TOOLS } from '../mcp/backend.js';
import { loadShippedPolicies } from '../cedar/engine.js';

export default {
  id: 'generic',
  label: 'Generic (travel, tickets, payments)',
  personas: PERSONAS,
  agent: AGENT,
  tools: GENERIC_TOOLS,
  schema: undefined, // the default schema (cedar/schema.cedarschema)
  shippedPolicies: () => loadShippedPolicies(),
  attribution: false,
  web: null,
};

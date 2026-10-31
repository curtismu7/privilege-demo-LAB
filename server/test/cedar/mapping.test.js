// Group -> tool mapping, driven only by the six shipped policies. Reusable by S35 and the Privilege demo.
// Not covered because no shipped policy decides them (see README): admins, ticketing for finance, anything an
// unconfirmed policy would add. Group names are the invented demo groups.
import { describe, it, expect } from 'vitest';
import { ask } from './helpers.js';

const claim = (sub, groups, scope = 'tools:invoke') => ({ sub, groups, scope, client_id: 'dot' });
const analyst = claim('a1', ['analysts']);
const finance = claim('f1', ['finance'], 'tools:invoke payments:write');
const financeNoScope = claim('f2', ['finance']);
const travel = claim('t1', ['travel-agents']);
const groups = { analyst, finance, financeNoScope, travel };

const A = 's04-analysts-search-ticketing';
const P = 's04-payments-finance-only';
const T = 's23-permit-travel-agents';
const CAP = 's23-forbid-over-cap';
const HOLD = 's01-hold-large-fare';
const PIN = 's05-rugpull-pin';
const UN = { action: 'mcp:InvokeUnattended' };
const fare = (amount, extra = {}) => ({ args: { amount }, ...extra });

// [group, tool, toolCall extras, expected decision, expected deciding rule]
const table = [
  ['analyst', 'search_docs', {}, 'allow', A],
  ['analyst', 'create_ticket', {}, 'allow', A],
  ['analyst', 'pay_invoice', {}, 'deny', 'default-deny'],
  ['financeNoScope', 'pay_invoice', {}, 'deny', 'default-deny'],
  ['finance', 'pay_invoice', {}, 'allow', P],
  ['travel', 'pay_invoice', {}, 'deny', 'default-deny'],
  ['travel', 'search_docs', {}, 'deny', 'default-deny'],
  ['analyst', 'book_fare', fare(500), 'deny', 'default-deny'],
  ['finance', 'book_fare', fare(500), 'deny', 'default-deny'],
  ['travel', 'book_fare', fare(500), 'allow', T],
  ['travel', 'book_fare', fare(1000, UN), 'allow', T],
  ['travel', 'book_fare', fare(1001, UN), 'deny', HOLD],
  ['travel', 'book_fare', fare(5000, { ...UN, approvalCount: 1 }), 'allow', T],
  ['travel', 'book_fare', fare(10000, { ...UN, approvalCount: 1 }), 'allow', T],
  ['travel', 'book_fare', fare(10000, UN), 'deny', HOLD],
  ['travel', 'book_fare', fare(10001), 'deny', CAP],
  ['travel', 'book_fare', fare(10001, { ...UN, approvalCount: 5 }), 'deny', CAP],
  ['analyst', 'search_docs', { pinnedHash: 'a', observedHash: 'b' }, 'deny', PIN],
  ['analyst', 'create_ticket', { pinnedHash: 'a', observedHash: 'b' }, 'deny', PIN],
  ['finance', 'pay_invoice', { pinnedHash: 'a', observedHash: 'b' }, 'deny', PIN],
  ['travel', 'book_fare', fare(500, { pinnedHash: 'a', observedHash: 'b' }), 'deny', PIN],
];

describe('group to tool mapping', () => {
  it.each(table)('%s calls %s %j -> %s by %s', (group, tool, extra, decision, rule) => {
    const d = ask(groups[group], tool, extra);
    expect({ decision: d.decision, rule: d.rule }).toEqual({ decision, rule });
  });
});

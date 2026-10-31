import { describe, it, expect } from 'vitest';
import { decide } from '../../src/cedar/index.js';
import { policySet, mary, fin, ta, ask } from './helpers.js';

const expectOne = (r, decision, rule) => {
  expect(r.decision).toBe(decision);
  expect(r.rule).toBe(rule);
};

describe('verified decision table (cedar.md section 6)', () => {
  it('S04 analysts: search_docs and create_ticket allow', () => {
    expectOne(ask(mary, 'search_docs'), 'allow', 's04-analysts-search-ticketing');
    expectOne(ask(mary, 'create_ticket'), 'allow', 's04-analysts-search-ticketing');
  });
  it('S04 payments: analyst without finance is default-deny; finance with scope allows', () => {
    const d = ask(mary, 'pay_invoice');
    expectOne(d, 'deny', 'default-deny');
    expect(d.rules).toEqual([]);
    expect(d.overridden).toEqual([]);
    expectOne(ask(fin, 'pay_invoice'), 'allow', 's04-payments-finance-only');
  });
  it('S04 payments: finance without payments:write scope is denied', () => {
    expectOne(ask({ ...fin, scope: 'tools:invoke' }, 'pay_invoice'), 'deny', 'default-deny');
  });
  it('S05 rug-pull pin: drifted hash denies, matching hash allows', () => {
    const d = ask(mary, 'search_docs', { pinnedHash: 'h-search', observedHash: 'h-EVIL' });
    expectOne(d, 'deny', 's05-rugpull-pin');
    expect(d.reason).toBe('Tool schema changed since it was approved');
    expect(d.overridden).toEqual(['s04-analysts-search-ticketing']);
    expectOne(ask(mary, 'search_docs', { pinnedHash: 'h-search', observedHash: 'h-search' }), 'allow', 's04-analysts-search-ticketing');
  });
  it('S01 hold: unattended 2400 with no approval denies on the hold rule; approval or small amount allows', () => {
    const base = { action: 'mcp:InvokeUnattended' };
    const held = ask(ta, 'book_fare', { ...base, args: { amount: 2400 } });
    expectOne(held, 'deny', 's01-hold-large-fare');
    expect(held.overridden).toEqual(['s23-permit-travel-agents']);
    expectOne(ask(ta, 'book_fare', { ...base, args: { amount: 2400 }, approvalCount: 1 }), 'allow', 's23-permit-travel-agents');
    expectOne(ask(ta, 'book_fare', { ...base, args: { amount: 400 } }), 'allow', 's23-permit-travel-agents');
  });
  it('headline: a forbid without @approvers is final, whatever else fired or was approved', () => {
    const base = { action: 'mcp:InvokeUnattended' };
    const big = ask(ta, 'book_fare', { ...base, args: { amount: 12000 } });
    expectOne(big, 'deny', 's23-forbid-over-cap');
    expect(big.reason).toBe('Hard cap: no booking over 10000 for anyone');
    expect(big.rules).toEqual(expect.arrayContaining(['s23-forbid-over-cap', 's01-hold-large-fare']));
    expect(big.overridden).toEqual(['s23-permit-travel-agents']);
    expectOne(ask(ta, 'book_fare', { ...base, args: { amount: 12000 }, approvalCount: 1 }), 'deny', 's23-forbid-over-cap');
    expectOne(ask(ta, 'book_fare', { ...base, args: { amount: 2400 } }), 'deny', 's01-hold-large-fare');
  });
  it('S23: forbid over cap beats the permit; 900 allows', () => {
    const d = ask(ta, 'book_fare', { args: { amount: 12000 } });
    expectOne(d, 'deny', 's23-forbid-over-cap');
    expect(d.rules).toEqual(['s23-forbid-over-cap']);
    expect(d.overridden).toEqual(['s23-permit-travel-agents']);
    expect(d.reason).toBe('Hard cap: no booking over 10000 for anyone');
    expectOne(ask(ta, 'book_fare', { args: { amount: 900 } }), 'allow', 's23-permit-travel-agents');
  });
});

describe('default deny and empty policy set', () => {
  it('an empty policy set denies everything with rule default-deny', () => {
    const empty = { staticPolicies: {}, annotations: {}, effects: {} };
    const d = ask(mary, 'search_docs', {}, empty);
    expectOne(d, 'deny', 'default-deny');
    expect(d.reason).toMatch(/default deny/);
  });
});

describe('stories', () => {
  it('S04: of three tools Mary gets two', () => {
    const tools = ['search_docs', 'create_ticket', 'pay_invoice'];
    const res = tools.map((t) => [t, ask(mary, t)]);
    expect(res.filter(([, d]) => d.decision === 'allow').map(([t]) => t)).toEqual(['search_docs', 'create_ticket']);
    const [, denied] = res[2];
    expect(denied.decision).toBe('deny');
    expect(denied.rule).toBe('default-deny');
  });
  it('S05: pinned tool swapped overnight is denied by s05-rugpull-pin', () => {
    const d = ask(mary, 'search_docs', { pinnedHash: 'approved', observedHash: 'swapped' });
    expectOne(d, 'deny', 's05-rugpull-pin');
  });
  it('S23: "Cedar says no even though another rule says yes"', () => {
    const d = ask(ta, 'book_fare', { args: { amount: 12000 } });
    expectOne(d, 'deny', 's23-forbid-over-cap');
    expect(d.overridden).toContain('s23-permit-travel-agents');
  });
});

describe('trace hook', () => {
  it('returns the fields for a trace-envelope hop', () => {
    const d = ask(ta, 'book_fare', { args: { amount: 900 } });
    expect(d.trace).toMatchObject({
      product: 'cedar',
      hop: 'policy:ai-policy',
      subject: 'ta1',
      actor: 'dot',
      decision: { result: 'allow', rule: 's23-permit-travel-agents', reason: 'Travel agents may book fares' },
    });
    expect(typeof d.trace.latency_ms).toBe('number');
    expect(d.trace.engine_version).toBe('4.14.0');
    expect(JSON.stringify(d)).not.toMatch(/eyJ/);
  });
  it('actor is null when act is absent', () => {
    expect(ask(mary, 'search_docs').trace.actor).toBeNull();
  });
});

describe('fail closed', () => {
  it('rejected claims deny with invalid-claims', () => {
    const d = ask({ ...mary, groups: 'analysts' }, 'search_docs');
    expectOne(d, 'deny', 'invalid-claims');
    expect(d.problems.length).toBeGreaterThan(0);
  });
  it('args outside the schema deny with invalid-request, never throw', () => {
    expectOne(ask(mary, 'search_docs', { args: { amount: 'lots' } }), 'deny', 'invalid-request');
    expectOne(decide({ policySet, claims: mary, toolCall: null }), 'deny', 'invalid-request');
    expectOne(ask(mary, 'search_docs', { action: 'mcp:Delete' }), 'deny', 'invalid-request');
  });
});

describe('determinism', () => {
  it('same input gives the same decision, rule, rules, overridden, reason', () => {
    const strip = ({ trace, ...rest }) => ({ ...rest, trace: { ...trace, latency_ms: 0 } });
    const a = strip(ask(ta, 'book_fare', { args: { amount: 12000 } }));
    for (let i = 0; i < 20; i++) expect(strip(ask(ta, 'book_fare', { args: { amount: 12000 } }))).toEqual(a);
  });
  it('does not mutate inputs', () => {
    const claims = structuredClone(ta);
    const call = { tool: 'book_fare', app: 'booking', args: { amount: 5 } };
    const before = structuredClone(call);
    decide({ policySet, claims, toolCall: call });
    expect(claims).toEqual(ta);
    expect(call).toEqual(before);
  });
});

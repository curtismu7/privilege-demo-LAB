import { describe, it, expect } from 'vitest';
import { loadShippedPolicies, decide } from '../../src/cedar/index.js';
import { validatePolicies, LIMITS } from '../../src/cedar/validatePolicies.js';
import './helpers.js';

const ok = 'permit (principal, action, resource) when { context.app == "x" };';

describe('validatePolicies', () => {
  it('accepts the six shipped policies', () => {
    const r = validatePolicies(loadShippedPolicies());
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.policySet.staticPolicies)).toHaveLength(6);
  });
  it('rejects vocabulary the schema does not have (context.claims)', () => {
    const r = validatePolicies({ bad: 'permit (principal, action, resource) when { context.claims.groups.contains("x") };' });
    expect(r.ok).toBe(false);
    expect(r.problems[0].message).toMatch(/claims/);
    expect(r.policySet).toBeNull();
  });
  it('malformed text returns problems, does not throw', () => {
    for (const t of ['permit (', '', 'garbage', ok + '\n' + ok, '\u0000\u0000', 'permit (principal, action, resource) when { };']) {
      const r = validatePolicies({ p: t });
      expect(r.ok).toBe(false);
      expect(r.problems.length).toBeGreaterThan(0);
    }
  });
  it('rejects templates (no template-linked policies in v1)', () => {
    const r = validatePolicies({ t: 'permit (principal == ?principal, action, resource);' });
    expect(r.ok).toBe(false);
    expect(r.problems[0].message).toMatch(/template|slot/i);
  });
  it('rejects non-object input and non-string text without throwing', () => {
    for (const input of [null, undefined, 'x', 5, [], {}, { p: 5 }, { p: null }, { 'bad id!': ok }]) {
      const r = validatePolicies(input);
      expect(r.ok).toBe(false);
    }
  });
  it('enforces size and count limits', () => {
    expect(validatePolicies({ p: ok + ' // ' + 'x'.repeat(LIMITS.maxPolicyBytes) }).ok).toBe(false);
    const many = Object.fromEntries(Array.from({ length: LIMITS.maxPolicies + 1 }, (_, i) => [`p${i}`, ok]));
    const r = validatePolicies(many);
    expect(r.ok).toBe(false);
    expect(r.problems[0].message).toMatch(/too many/);
    const big = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, ok + ' // ' + 'x'.repeat(3000)]));
    expect(validatePolicies(big).problems.some((p) => /total/.test(p.message))).toBe(true);
  });
  it('survives pathological nesting and keeps working afterwards', () => {
    const n = '('.repeat(3500) + 'true' + ')'.repeat(3500);
    const r = validatePolicies({ p: `permit (principal, action, resource) when { ${n} };` });
    expect(r.ok).toBe(false);
    expect(validatePolicies({ p: ok }).ok).toBe(true);
  });
  const dots = { p: 'permit(principal,action,resource) when { context' + '.a'.repeat(1900) + ' };' };
  it('rejects a long dotted accessor chain under the size limit and keeps working', () => {
    expect(Buffer.byteLength(dots.p)).toBeLessThan(LIMITS.maxPolicyBytes);
    const r = validatePolicies(dots);
    expect(r.ok).toBe(false);
    expect(r.problems[0].message).toMatch(/accessors/);
    const shipped = validatePolicies(loadShippedPolicies());
    expect(shipped.ok).toBe(true);
    const claims = { sub: 'mary', groups: ['analysts'], scope: 'x', client_id: 'dot' };
    const d = decide({ policySet: shipped.policySet, claims, toolCall: { tool: 'search_docs', app: 'search', pinnedHash: 'h', observedHash: 'h' } });
    expect(d.rule).toBe('s04-analysts-search-ticketing');
  });
  it('recovers from a wasm trap even if the pre-check misses the input', () => {
    const saved = LIMITS.maxDots;
    LIMITS.maxDots = Infinity;
    try {
      expect(validatePolicies(dots).ok).toBe(false);
    } finally { LIMITS.maxDots = saved; }
    const shipped = validatePolicies(loadShippedPolicies());
    expect(shipped.ok).toBe(true);
  });
  it('rejects an @id that disagrees with the policy id', () => {
    const r = validatePolicies({ a: '@id("b")\n' + ok });
    expect(r.ok).toBe(false);
  });
});

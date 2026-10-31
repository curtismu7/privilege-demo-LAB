// Pins the documented limits with fixed numbers. Do not derive these from LIMITS.*: the point is to notice a change.
import { describe, it, expect } from 'vitest';
import { validatePolicies, LIMITS } from '../../src/cedar/validatePolicies.js';
import { mapClaims, MAX_GROUPS, MAX_SCOPES, MAX_STRING } from '../../src/cedar/mapClaims.js';
import './helpers.js';

const base = 'permit (principal, action, resource) when { context.app == "x" };';
// Pads a policy with a trailing comment so the whole text is exactly `bytes` long.
const padTo = (bytes) => base + ' //' + 'x'.repeat(bytes - Buffer.byteLength(base) - 3);

describe('documented limits (values)', () => {
  it('are exactly the numbers in the README', () => {
    expect(LIMITS).toEqual({ maxPolicies: 50, maxPolicyBytes: 4096, maxTotalBytes: 65536, maxNesting: 32, maxDots: 64 });
    expect(MAX_GROUPS).toBe(100);
    expect(MAX_SCOPES).toBe(100);
    expect(MAX_STRING).toBe(256);
  });
});

describe('policy limits at the boundary', () => {
  it('50 policies accepted, 51 rejected', () => {
    const n = (k) => Object.fromEntries(Array.from({ length: k }, (_, i) => [`p${i}`, base]));
    expect(validatePolicies(n(50)).ok).toBe(true);
    const r = validatePolicies(n(51));
    expect(r.ok).toBe(false);
    expect(r.problems[0].message).toMatch(/too many/);
  });
  it('4096 bytes per policy accepted, 4097 rejected', () => {
    expect(validatePolicies({ p: padTo(4096) }).ok).toBe(true);
    const r = validatePolicies({ p: padTo(4097) });
    expect(r.ok).toBe(false);
    expect(r.problems[0].message).toMatch(/too large/);
  });
  it('65536 bytes in total accepted, 65537 rejected', () => {
    const set = (extra) => ({ ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`p${i}`, padTo(4096)])), ...(extra ? { x: padTo(extra) } : {}) });
    expect(Buffer.byteLength(Object.values(set()).join(''))).toBe(65536);
    expect(validatePolicies(set()).ok).toBe(true);
    const over = validatePolicies(set(Buffer.byteLength(base) + 3));
    expect(over.ok).toBe(false);
    expect(over.problems.some((p) => /total/.test(p.message))).toBe(true);
  });
  it('nesting depth 32 accepted, 33 rejected', () => {
    expect(validatePolicies({ p: base + ' //' + '('.repeat(32) }).ok).toBe(true);
    const r = validatePolicies({ p: base + ' //' + '('.repeat(33) });
    expect(r.ok).toBe(false);
    expect(r.problems[0].message).toMatch(/nested too deeply/);
  });
  it('64 dots accepted, 65 rejected', () => {
    const withDots = (n) => base + ' //' + '.'.repeat(n - 1); // base has one dot already
    expect(validatePolicies({ p: withDots(64) }).ok).toBe(true);
    const r = validatePolicies({ p: withDots(65) });
    expect(r.ok).toBe(false);
    expect(r.problems[0].message).toMatch(/accessors/);
  });
});

describe('claim limits at the boundary', () => {
  const claims = (extra) => ({ sub: 'u', client_id: 'dot', ...extra });
  const names = (n) => Array.from({ length: n }, (_, i) => `g${i}`);
  it('100 groups kept whole, 101 truncated to 100', () => {
    const a = mapClaims(claims({ groups: names(100) }));
    expect(a.ok).toBe(true);
    expect(a.truncated).toBe(false);
    expect(a.entities[0].parents).toHaveLength(100);
    const b = mapClaims(claims({ groups: names(101) }));
    expect(b.truncated).toBe(true);
    expect(b.entities[0].parents).toHaveLength(100);
  });
  it('100 scopes accepted, 101 rejected', () => {
    expect(mapClaims(claims({ scope: names(100).join(' ') })).ok).toBe(true);
    expect(mapClaims(claims({ scope: names(101).join(' ') })).ok).toBe(false);
  });
  it('256-character strings accepted, 257 rejected (sub, group, scope)', () => {
    const s = (n) => 'a'.repeat(n);
    expect(mapClaims(claims({ sub: s(256) })).ok).toBe(true);
    expect(mapClaims(claims({ sub: s(257) })).ok).toBe(false);
    expect(mapClaims(claims({ groups: [s(256)] })).ok).toBe(true);
    expect(mapClaims(claims({ groups: [s(257)] })).ok).toBe(false);
    expect(mapClaims(claims({ scope: s(256) })).ok).toBe(true);
    expect(mapClaims(claims({ scope: s(257) })).ok).toBe(false);
  });
});

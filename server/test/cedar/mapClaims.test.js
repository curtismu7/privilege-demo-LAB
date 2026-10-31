import { describe, it, expect } from 'vitest';
import { mapClaims } from '../../src/cedar/index.js';
import { MAX_GROUPS } from '../../src/cedar/mapClaims.js';

const base = { sub: 'u1', client_id: 'dot', scope: 'a b' };

describe('mapClaims', () => {
  it('maps sub, groups, scope, client_id', () => {
    const m = mapClaims({ ...base, groups: ['g1', 'g2'] });
    expect(m.ok).toBe(true);
    expect(m.principal).toEqual({ type: 'User', id: 'u1' });
    expect(m.entities[0].parents).toEqual([{ type: 'Group', id: 'g1' }, { type: 'Group', id: 'g2' }]);
    expect(m.token).toEqual({ scopes: ['a', 'b'], client_id: 'dot' });
  });
  it('missing groups and scope are empty, not errors', () => {
    const m = mapClaims({ sub: 'u1', client_id: 'dot' });
    expect(m.ok).toBe(true);
    expect(m.entities).toHaveLength(1);
    expect(m.entities[0].parents).toEqual([]);
    expect(m.token.scopes).toEqual([]);
  });
  it('caps a huge group list and flags it', () => {
    const groups = Array.from({ length: 5000 }, (_, i) => `g${i}`);
    const m = mapClaims({ ...base, groups });
    expect(m.ok).toBe(true);
    expect(m.truncated).toBe(true);
    expect(m.entities[0].parents).toHaveLength(MAX_GROUPS);
  });
  it('rejects claims that are not plain JSON', () => {
    class Evil { constructor() { this.x = 1; } }
    for (const bad of [
      { ...base, extra: new Date() },
      { ...base, extra: new Evil() },
      { ...base, extra: () => 1 },
      { ...base, extra: new Map() },
      { ...base, extra: 1n },
      { ...base, extra: NaN },
      { ...base, extra: Symbol('s') },
      { ...base, extra: { a: { b: { c: { d: { e: 1 } } } } } },
      { ...base, groups: [{ toString: () => 'x' }] },
      Object.assign(Object.create({ inherited: 1 }), base),
    ]) {
      const m = mapClaims(bad);
      expect(m.ok).toBe(false);
      expect(m.problems.length).toBeGreaterThan(0);
    }
  });
  it('rejects non-objects and missing sub or client_id', () => {
    for (const bad of [null, 'x', 1, [], {}, { sub: 'u' }, { client_id: 'c' }, { sub: '', client_id: 'c' }]) {
      expect(mapClaims(bad).ok).toBe(false);
    }
  });
  it('act present gives actor; absent gives none; string act is rejected', () => {
    expect(mapClaims({ ...base, act: { sub: 'dot' } }).token.actor).toBe('dot');
    expect('actor' in mapClaims(base).token).toBe(false);
    expect(mapClaims({ ...base, act: 'dot' }).ok).toBe(false);
    expect(mapClaims({ ...base, act: { client_id: 'x' } }).ok).toBe(false);
  });
  it('a __proto__ key from JSON.parse is not read as a claim', () => {
    const m = mapClaims(JSON.parse('{"sub":"u","client_id":"c","__proto__":{"groups":["admin"]}}'));
    expect(m.ok).toBe(true);
    expect(m.entities).toHaveLength(1);
  });
});

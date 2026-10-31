import { describe, it, expect } from 'vitest';
import { decide } from '../../src/cedar/index.js';
import { policySet, mary } from './helpers.js';

const call = { tool: 'search_docs', app: 'search', pinnedHash: 'h', observedHash: 'h' };
const throwing = () => { throw new Error('SECRET-INTERNAL boom'); };
const getterObj = (base) => Object.defineProperty({ ...base }, 'sub', { enumerable: true, get: throwing });
const proxy = () => new Proxy({}, { get: throwing, ownKeys: throwing, getPrototypeOf: throwing, has: throwing, getOwnPropertyDescriptor: throwing });
const cyclic = () => { const o = { sub: 'mary', client_id: 'dot' }; o.self = o; return o; };
const deep = (n) => { let o = {}; const root = o; for (let i = 0; i < n; i++) { o.n = {}; o = o.n; } return root; };

function expectDenied(d, marker = 'SECRET-INTERNAL') {
  expect(d.decision).toBe('deny');
  expect(typeof d.rule).toBe('string');
  expect(d.trace.decision.result).toBe('deny');
  const text = JSON.stringify(d);
  expect(text).not.toContain(marker);
  expect(text).not.toMatch(/\n\s+at /);
}

describe('decide never throws (fail closed)', () => {
  const cases = {
    'no arguments': () => decide(),
    'null': () => decide(null),
    'string': () => decide('x'),
    'number': () => decide(5),
    'empty object': () => decide({}),
    'claims is a string': () => decide({ policySet, claims: 'abc', toolCall: call }),
    'toolCall is a string': () => decide({ policySet, claims: mary, toolCall: 'abc' }),
    'claims with a throwing getter': () => decide({ policySet, claims: getterObj(mary), toolCall: call }),
    'claims is a throwing Proxy': () => decide({ policySet, claims: proxy(), toolCall: call }),
    'toolCall with a throwing getter': () => decide({ policySet, claims: mary, toolCall: Object.defineProperty({ app: 'search' }, 'tool', { enumerable: true, get: throwing }) }),
    'toolCall is a throwing Proxy': () => decide({ policySet, claims: mary, toolCall: proxy() }),
    'args is a throwing Proxy': () => decide({ policySet, claims: mary, toolCall: { ...call, args: proxy() } }),
    'policySet is a throwing Proxy': () => decide({ policySet: proxy(), claims: mary, toolCall: call }),
    'policySet getter throws': () => decide({ get policySet() { throw new Error('SECRET-INTERNAL'); }, claims: mary, toolCall: call }),
    'cyclic claims': () => decide({ policySet, claims: cyclic(), toolCall: call }),
    'cyclic args': () => { const a = {}; a.a = a; return decide({ policySet, claims: mary, toolCall: { ...call, args: a } }); },
    'huge nested claims': () => decide({ policySet, claims: { ...mary, extra: deep(100000) }, toolCall: call }),
    'huge nested args': () => decide({ policySet, claims: mary, toolCall: { ...call, args: deep(100000) } }),
  };
  for (const [name, run] of Object.entries(cases)) {
    it(`denies: ${name}`, () => {
      let d;
      expect(() => { d = run(); }).not.toThrow();
      expectDenied(d);
    });
  }
  it('does not echo input values in the reason', () => {
    const d = decide({ policySet, claims: { ...mary, sub: 'ECHO-ME-12345', groups: 7 }, toolCall: call });
    expect(JSON.stringify(d)).not.toContain('ECHO-ME-12345');
  });
  it('a throwing input uses the "error" rule with a plain reason', () => {
    const d = decide({ policySet, claims: proxy(), toolCall: call });
    expect(d.rule).toBe('error');
    expect(d.reason).toMatch(/could not be read/);
    expect(d.problems).toEqual(['input could not be read']);
  });
});

describe('pinnedHash is required (S05 cannot be silently disabled)', () => {
  const ask = (extra) => decide({ policySet, claims: mary, toolCall: { tool: 'search_docs', app: 'search', ...extra } });
  it('missing pinnedHash denies even when everything else would allow', () => {
    const d = ask({ observedHash: 'h' });
    expect(d.decision).toBe('deny');
    expect(d.rule).toBe('invalid-request');
    expect(d.reason).toMatch(/pinnedHash/);
  });
  it('non-string or empty pinnedHash denies', () => {
    for (const pinnedHash of [undefined, null, 5, {}, ['h'], '']) {
      expect(ask({ pinnedHash, observedHash: 'h' }).rule).toBe('invalid-request');
    }
  });
  it('omitting both hashes does not allow', () => {
    expect(ask({}).decision).toBe('deny');
  });
  it('a supplied pinnedHash still allows when it matches', () => {
    expect(ask({ pinnedHash: 'h', observedHash: 'h' }).decision).toBe('allow');
  });
});

import { describe, expect, it } from 'vitest';
import { argProblems, createBackend, schemaHash } from '../../src/mcp/backend.js';

describe('mock MCP backend', () => {
  const b = createBackend();
  it('exposes the four tools with an app each and a hash', () => {
    const tools = b.listTools();
    expect(tools.map((t) => [t.name, t._meta.app])).toEqual([['search_flights', 'search'], ['create_ticket', 'ticketing'], ['pay_invoice', 'payments'], ['book_fare', 'booking']]);
    for (const t of tools) expect(t._meta.schemaHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('results are deterministic', () => {
    expect(b.callTool('book_fare', { flightId: 'FL200', amount: 1450 })).toEqual(b.callTool('book_fare', { flightId: 'FL200', amount: 1450 }));
    expect(b.callTool('book_fare', { flightId: 'FL200', amount: 1450 }).status).toBe('booked');
  });
  it('observed equals pinned until a tool drifts; resetting restores it; only that tool changes', () => {
    const x = createBackend();
    expect(x.observedHash('book_fare')).toBe(x.pinnedHash('book_fare'));
    expect(x.setDrift('book_fare', true)).toBe(true);
    expect(x.observedHash('book_fare')).not.toBe(x.pinnedHash('book_fare'));
    expect(x.observedHash('pay_invoice')).toBe(x.pinnedHash('pay_invoice'));
    expect(x.listTools().find((t) => t.name === 'book_fare').description).toMatch(/external address/);
    x.resetDrift();
    expect(x.observedHash('book_fare')).toBe(x.pinnedHash('book_fare'));
    expect(x.setDrift('nope', true)).toBe(false);
  });
  it('schemaHash ignores key order', () => {
    expect(schemaHash({ name: 'a', description: 'd', inputSchema: { a: 1, b: 2 } })).toBe(schemaHash({ inputSchema: { b: 2, a: 1 }, description: 'd', name: 'a' }));
  });
  it('rpc handles initialize, ping, tools/list, unknown; tools/call is left to the PEP', () => {
    expect(b.rpc({ method: 'initialize', params: { protocolVersion: '2025-06-18' } }).result.protocolVersion).toBe('2025-06-18');
    expect(b.rpc({ method: 'ping' })).toEqual({ result: {} });
    expect(b.rpc({ method: 'tools/list' }).result.tools).toHaveLength(4);
    expect(b.rpc({ method: 'tools/call' })).toBeUndefined();
    expect(b.rpc({ method: 'x' }).error.code).toBe(-32601);
  });
  it('argProblems', () => {
    const s = b.tool('book_fare').inputSchema;
    expect(argProblems(s, { flightId: 'F', amount: 10 })).toEqual([]);
    expect(argProblems(s, { flightId: 'F' })).toContain('missing argument amount');
    expect(argProblems(s, { flightId: 'F', amount: 1.5 })).toHaveLength(1);
    expect(argProblems(s, { flightId: 'F', amount: '5' })).toHaveLength(1);
    expect(argProblems(s, { flightId: 'F', amount: -1 })).toHaveLength(1);
    expect(argProblems(s, { flightId: 'F', amount: 1, extra: 1 })).toContain('unknown argument extra');
    expect(argProblems(s, { flightId: 'F', amount: 1, __proto__: { x: 1 } })).toEqual([]);
    expect(argProblems(s, [])).toHaveLength(1);
    expect(argProblems(s, null)).toHaveLength(1);
  });
});

import { it, expect } from 'vitest';
import net from 'node:net';

it('the network guard is active, so passing tests prove offline operation', async () => {
  expect(() => new net.Socket().connect(80, '127.0.0.1')).toThrow(/network blocked/);
  expect(() => fetch('http://127.0.0.1')).toThrow(/network blocked/);
});

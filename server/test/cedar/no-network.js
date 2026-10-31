// Any socket, DNS lookup or fetch during tests is a failure: this module must work fully offline.
import net from 'node:net';
import dns from 'node:dns';
const blocked = (what) => () => { throw new Error(`network blocked in tests: ${what}`); };
net.Socket.prototype.connect = blocked('net.Socket.connect');
dns.lookup = blocked('dns.lookup');
globalThis.fetch = blocked('fetch');

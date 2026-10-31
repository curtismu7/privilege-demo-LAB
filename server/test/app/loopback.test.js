// The demo is loopback-only: host-run defaults to 127.0.0.1 in every mode, and Docker publishes on 127.0.0.1 only.
import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';

const root = new URL('../../../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), 'utf8');
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe('loopback-only', () => {
  it('host-run binds 127.0.0.1 by default in local-mock and in pf mode', () => {
    delete process.env.HOST;
    for (const idp of ['local-mock', 'pf']) {
      process.env.IDP = idp;
      expect(config().host).toBe('127.0.0.1');
    }
  });

  it('HOST still overrides the default', () => {
    process.env.HOST = '0.0.0.0';
    expect(config().host).toBe('0.0.0.0');
  });

  it('docker-compose publishes every host port on 127.0.0.1 only', () => {
    const ports = [...read('docker-compose.yml').matchAll(/^\s*-\s*"([^"]*:\d+(?:\/\w+)?)"\s*$/gm)].map((m) => m[1]);
    expect(ports.length).toBeGreaterThan(0);
    for (const p of ports) expect(p, p).toMatch(/^127\.0\.0\.1:/);
  });

  it('the container listens on all interfaces itself (HOST=0.0.0.0 in the Dockerfile), which compose then publishes on loopback', () => {
    expect(read('Dockerfile')).toMatch(/ENV[^\n]*\bHOST=0\.0\.0\.0\b/);
  });
});

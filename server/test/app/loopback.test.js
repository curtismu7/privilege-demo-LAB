// The demo is loopback-only: host-run defaults to 127.0.0.1 in every mode, and Docker publishes on 127.0.0.1 only.
import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';

const root = new URL('../../../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), 'utf8');
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe('loopback-only', () => {
  it('host-run binds 127.0.0.1 by default in mock and in live mode, on port 4510', () => {
    delete process.env.HOST;
    delete process.env.PORT;
    for (const mode of ['mock', 'live']) {
      process.env.DEMO_MODE = mode;
      expect(config().host).toBe('127.0.0.1');
    }
    expect(config().port).toBe(4510);
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

  it('compose says the port is loopback-published (LAB_PUBLISH) wherever it allows mock sign-in, and the app is the only service with ports', () => {
    const compose = read('docker-compose.yml');
    expect(compose).toMatch(/ALLOW_MOCK_SIGNIN: "1"/);
    expect(compose).toMatch(/LAB_PUBLISH: loopback/);
    expect(compose.match(/^\s+ports:/gm)).toHaveLength(1);
  });

  it('the container listens on all interfaces itself (HOST=0.0.0.0 in the Dockerfile), which compose then publishes on loopback', () => {
    expect(read('Dockerfile')).toMatch(/ENV[^\n]*\bHOST=0\.0\.0\.0\b/);
  });

  it('the images run Node 26 and a non-root user, and the app image does not set mock sign-in itself', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile.match(/^FROM node:(\d+)/gm).every((l) => l === 'FROM node:26')).toBe(true);
    expect(dockerfile).toMatch(/USER node/);
    expect(dockerfile).not.toMatch(/ALLOW_MOCK_SIGNIN/);
  });
});

describe('the shared settings file in Docker', () => {
  it('the base compose never sets PF_ values to empty (an empty real variable beats the shared file)', () => {
    const compose = read('docker-compose.yml');
    expect(compose).not.toMatch(/PF_(URL|AUDIENCE|HTTP_HOSTS):\s*\$\{/);
    expect(compose).not.toMatch(/env_file/);
  });
  it('the overlay mounts the file read-only, never creates it, and does not use env_file (which would copy every key)', () => {
    const overlay = read('docker-compose.shared-env.yml');
    expect(overlay).toMatch(/read_only: true/);
    expect(overlay).toMatch(/create_host_path: false/);
    expect(overlay).toMatch(/STANDALONE_ENV: \/run\/standalone\.env/);
    expect(overlay).not.toMatch(/^\s*env_file:/m);
    expect(overlay).not.toMatch(/ports:/);
  });
});

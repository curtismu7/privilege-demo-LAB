// The npm scripts, run for real: doctor (offline, mock mode) and reset (against an app listening on loopback).
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { mockApp, tmpDir } from './helpers.js';

const run = promisify(execFile);
const root = path.resolve(new URL('../../../', import.meta.url).pathname);
const env = (extra = {}) => ({ PATH: process.env.PATH, HOME: process.env.HOME, STANDALONE_ENV: '/nonexistent/none.env', ...extra });

describe('npm run doctor', () => {
  it('passes offline in mock mode: every line is ok, none is FAIL', async () => {
    const { stdout } = await run(process.execPath, ['scripts/doctor.mjs'], { cwd: root, env: env({ PORT: '4768', DATA_DIR: tmpDir() }), timeout: 60000 });
    const lines = stdout.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(10);
    expect(lines.filter((l) => !l.startsWith('ok    '))).toEqual([]);
    expect(stdout).toMatch(/^ok {4}node 26 or newer: Node 26\./m);
    expect(stdout).toMatch(/netguard self-test, zero outbound attempts/);
    expect(stdout).toMatch(/health route answers demo-health\/1/);
  }, 60000);

  it('fails with exit 1 and names the problem when live mode is chosen with no PingFederate settings', async () => {
    const res = await run(process.execPath, ['scripts/doctor.mjs'], { cwd: root, env: env({ PORT: '4768', DEMO_MODE: 'live' }), timeout: 60000 }).catch((e) => e);
    expect(res.code).toBe(1);
    expect(res.stdout).toMatch(/FAIL {2}configuration is valid: live mode needs PF_URL/);
  }, 60000);
});

describe('Node 26 only (owner decision 2026-10-31)', () => {
  it('no source, script, doc or config file names Node 18, 20, 22 or 24 as supported', async () => {
    const { stdout } = await run('git', ['grep', '-n', '-I', '-i', '-E', 'node(js)?[ -]?(v|version |>=)?(18|20|22|24)\\b|node@(18|20|22|24)|node:(18|20|22|24)', '--', '.', ':!package-lock.json', ':!CHANGELOG.md', ':!server/test/app/scripts.test.js'], { cwd: root }).catch((e) => (e.code === 1 ? { stdout: '' } : Promise.reject(e)));
    expect(stdout).toBe('');
  });
});

describe('npm run reset', () => {
  it('clears one workspace on the running app and leaves the others', async () => {
    const ctx = mockApp();
    const server = http.createServer(ctx.app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}`;
      const hold = async (workspace) => {
        const agent = request.agent(ctx.app);
        await agent.post('/api/auth/mock/login').set('x-workspace', workspace).send({ persona: 'mark' });
        return agent.post('/api/tools/call').set('x-workspace', workspace).send({ tool: 'book_fare', args: { flightId: 'F', amount: 2400 }, asAgent: true });
      };
      expect((await hold('alpha')).status).toBe(202);
      expect((await hold('beta')).status).toBe(202);
      const { stdout } = await run(process.execPath, ['scripts/reset.mjs', 'alpha'], { cwd: root, env: env({ APP_URL: url }), timeout: 30000 });
      expect(stdout).toMatch(/reset workspace "alpha": 1 approval\(s\)/);
      expect(ctx.app.locals.workspaces.peek('alpha').approvals.list()).toHaveLength(0);
      expect(ctx.app.locals.workspaces.peek('beta').approvals.list()).toHaveLength(1);
    } finally { server.closeAllConnections(); server.close(); }
  }, 60000);

  it('refuses a bad workspace id and a non-loopback APP_URL, and says plainly when no app is running', async () => {
    const bad = await run(process.execPath, ['scripts/reset.mjs', 'Bad_Id'], { cwd: root, env: env() }).catch((e) => e);
    expect(bad.code).toBe(1);
    const remote = await run(process.execPath, ['scripts/reset.mjs', 'a'], { cwd: root, env: env({ APP_URL: 'http://pf.example:80' }) }).catch((e) => e);
    expect(remote.code).toBe(1);
    expect(remote.stderr).toMatch(/loopback/);
    const none = await run(process.execPath, ['scripts/reset.mjs', 'a'], { cwd: root, env: env({ PORT: '4769' }) });
    expect(none.stdout).toMatch(/no app answers/);
  }, 60000);
});

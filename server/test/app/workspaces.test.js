import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { makeApp, mockApp, tmpDir } from './helpers.js';
import { MAX_WORKSPACES, validWorkspace } from '../../src/workspaces.js';

const ws = (name) => ({ 'x-workspace': name });
async function login(ctx, persona, workspace) {
  if (persona === 'dana') fs.writeFileSync(ctx.cfg.adminSwitchFile, 'on');
  const agent = request.agent(ctx.app);
  const r = await agent.post('/api/auth/mock/login').set(ws(workspace)).send({ persona });
  if (r.status !== 200) throw new Error(`login ${persona} -> ${r.status}`);
  return (path, body) => (body === undefined ? agent.get(path) : agent.post(path).send(body)).set(ws(workspace));
}
const hold = (call) => call('/api/tools/call', { tool: 'book_fare', args: { flightId: 'FL200', amount: 2400 }, asAgent: true });

describe('workspace id (rule 13)', () => {
  it('validates ids', () => {
    for (const ok of ['default', 'acme-demo', 'a', '0x']) expect(validWorkspace(ok), ok).toBe(true);
    for (const bad of ['', 'Upper', '-lead', 'has space', 'a'.repeat(33), '../x', 'a/b', undefined, 5]) expect(validWorkspace(bad), String(bad)).toBe(false);
  });
  it('a bad id is a 400 and creates nothing', async () => {
    const ctx = mockApp();
    const r = await request(ctx.app).get('/api/mode').set(ws('../etc'));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bad_workspace');
    expect(ctx.app.locals.workspaces.ids()).toEqual(['default']);
  });
  it('the number of workspaces is capped', async () => {
    const ctx = mockApp();
    for (let i = 1; i < MAX_WORKSPACES; i++) ctx.app.locals.workspaces.get(`w${i}`);
    expect(ctx.app.locals.workspaces.ids()).toHaveLength(MAX_WORKSPACES);
    const r = await request(ctx.app).get('/api/trace').set(ws('one-too-many'));
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('too_many_workspaces');
  });
});

describe('workspaces scope sign-in, approvals, trace, policies and drift', () => {
  it('a sign-in in one workspace is not a sign-in in another', async () => {
    const ctx = mockApp();
    const cookie = (await request(ctx.app).post('/api/auth/mock/login').set(ws('alpha')).send({ persona: 'mark' })).headers['set-cookie'][0];
    expect(cookie).toMatch(/^pd_session_alpha=/);
    const send = (w) => request(ctx.app).get('/api/me').set(ws(w)).set('cookie', cookie.split(';')[0]);
    expect((await send('alpha')).status).toBe(200);
    expect((await send('beta')).status).toBe(401);
    // Renaming the cookie to another workspace's name does not help: the workspace is signed inside it.
    const stolen = cookie.split(';')[0].replace('pd_session_alpha', 'pd_session_beta');
    expect((await request(ctx.app).get('/api/me').set(ws('beta')).set('cookie', stolen)).status).toBe(401);
  });

  it('approvals and the trace stay in their workspace', async () => {
    const ctx = mockApp();
    const markA = await login(ctx, 'mark', 'alpha');
    const priyaA = await login(ctx, 'priya', 'alpha');
    const priyaB = await login(ctx, 'priya', 'beta');
    expect((await hold(markA)).status).toBe(202);
    expect((await priyaA('/api/approvals')).body.approvals).toHaveLength(1);
    expect((await priyaB('/api/approvals')).body.approvals).toHaveLength(0);
    expect((await priyaA('/api/trace')).body.events.length).toBeGreaterThan(0);
    expect((await priyaB('/api/trace')).body.events.filter((e) => e.hop === 'pep')).toHaveLength(0);
  });

  it('policy edits and tool drift stay in their workspace, and the files live under DATA_DIR/workspaces/<id>', async () => {
    const dataDir = tmpDir();
    const ctx = mockApp({ dataDir });
    const danaA = await login(ctx, 'dana', 'alpha');
    const danaB = await login(ctx, 'dana', 'beta');
    expect((await danaA('/api/admin/drift', { tool: 'search_flights', on: true })).status).toBe(200);
    expect((await danaA('/api/tools')).body.tools.find((t) => t.name === 'search_flights').drifted).toBe(true);
    expect((await danaB('/api/tools')).body.tools.find((t) => t.name === 'search_flights').drifted).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'workspaces', 'alpha', 'policies', 'active'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'policies', 'active'))).toBe(true); // default workspace keeps the original layout
    expect(fs.existsSync(path.join(dataDir, 'workspaces', 'alpha', 'policies', 'active', 's05-rugpull-pin.cedar'))).toBe(true);
  });
});

describe('reset clears the current workspace only', () => {
  it('the admin reset (POST /api/reset) and the script route (POST /api/workspaces/:id/reset)', async () => {
    const ctx = mockApp();
    const markA = await login(ctx, 'mark', 'alpha');
    const markB = await login(ctx, 'mark', 'beta');
    const danaA = await login(ctx, 'dana', 'alpha');
    await hold(markA); await hold(markB);
    expect((await danaA('/api/admin/drift', { tool: 'search_flights', on: true })).status).toBe(200);

    // The script route needs no sign-in from this machine, and touches only the named workspace.
    const r = await request(ctx.app).post('/api/workspaces/alpha/reset').send({});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, workspace: 'alpha', cleared: { approvals: 1, driftedTools: 1 } });
    expect((await markA('/api/approvals')).body.approvals).toHaveLength(0);
    expect((await markB('/api/approvals')).body.approvals).toHaveLength(1);
    expect((await markA('/api/tools')).body.tools.every((t) => !t.drifted)).toBe(true);
    // Sign-ins stay.
    expect((await markA('/api/me')).status).toBe(200);

    // The admin button resets the workspace it is called in.
    const danaB = await login(ctx, 'dana', 'beta');
    expect((await danaB('/api/reset', {})).body).toMatchObject({ ok: true, workspace: 'beta', cleared: { approvals: 1 } });
    expect((await markB('/api/approvals')).body.approvals).toHaveLength(0);
  });
  it('the script route refuses a proxied request and a bad workspace id; an admin may use it from anywhere', async () => {
    const ctx = mockApp();
    expect((await request(ctx.app).post('/api/workspaces/alpha/reset').set('x-forwarded-for', '9.9.9.9').send({})).status).toBe(403);
    expect((await request(ctx.app).post('/api/workspaces/Bad_Id/reset').send({})).status).toBe(400);
    const dana = await login(ctx, 'dana', 'alpha');
    const viaProxy = await request.agent(ctx.app).post('/api/auth/mock/login').set(ws('alpha')).send({ persona: 'dana' });
    expect(viaProxy.status).toBe(200);
    expect(await dana('/api/me')).toBeTruthy();
  });
  it('a policy edited by an admin comes back to the shipped text on reset', async () => {
    const ctx = mockApp();
    const dana = await login(ctx, 'dana', 'default');
    const first = (await dana('/api/policies')).body.policies.find((p) => p.id === 's01-hold-large-fare');
    const edited = `// edited in a test\n${first.text}`;
    const put = await request(ctx.app).put('/api/policies/s01-hold-large-fare').set('cookie', (await request(ctx.app).post('/api/auth/mock/login').send({ persona: 'dana' })).headers['set-cookie'][0].split(';')[0]).send({ text: edited });
    expect(put.status).toBe(200);
    expect((await dana('/api/policies')).body.policies.find((p) => p.id === 's01-hold-large-fare').text).toBe(edited);
    await request(ctx.app).post('/api/workspaces/default/reset').send({});
    expect((await dana('/api/policies')).body.policies.find((p) => p.id === 's01-hold-large-fare').text).toBe(first.text);
  });
});

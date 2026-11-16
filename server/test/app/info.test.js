import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockApp, tmpDir } from './helpers.js';

// GET /api/info answers the Privilege gateway card: realAvailable means the gateway door is configured
// (PDG_GW_* in the shared settings file), not live mode. The settings file is a throwaway one here, never ~/Development/.env.
const KEY = 'pd-test-agent-key-0123456789abcdef';
let saved;
beforeEach(() => {
  saved = Object.fromEntries(Object.entries(process.env).filter(([k]) => k === 'STANDALONE_ENV' || k.startsWith('PDG_GW_')));
  for (const k of Object.keys(saved)) delete process.env[k];
});
afterEach(() => {
  for (const k of Object.keys(process.env)) if (k === 'STANDALONE_ENV' || k.startsWith('PDG_GW_')) delete process.env[k];
  Object.assign(process.env, saved);
});
const settingsFile = (text) => {
  const file = path.join(tmpDir(), 'settings.env');
  fs.writeFileSync(file, text);
  process.env.STANDALONE_ENV = file;
};

describe('GET /api/info (the Privilege gateway card)', () => {
  it('gateway not configured: realAvailable false with the reason, and the mode stays the lab\'s own', async () => {
    settingsFile('');
    const ctx = mockApp();
    const r = await request(ctx.app).get('/api/info');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toEqual({ source: 'mock', realAvailable: false, realReason: expect.stringMatching(/gateway settings/) });
    expect((await request(ctx.app).get('/api/mode')).body).toMatchObject({ mode: 'mock', liveReady: false });
  });

  it('gateway configured: realAvailable true, and no key, key name or gateway URL in the answer', async () => {
    settingsFile(`PDG_GW_URL=https://gateway.example/door\nPDG_GW_APPS=travel-door\nPDG_GW_KEY_TRAVEL_AGENT=${KEY}\n`);
    const ctx = mockApp();
    const r = await request(ctx.app).get('/api/info');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ source: 'mock', realAvailable: true, realReason: null });
    const text = JSON.stringify(r.body) + JSON.stringify(r.headers);
    for (const secret of [KEY, KEY.slice(0, 12), 'PDG_GW_KEY', 'gateway.example']) expect(text).not.toContain(secret);
    expect((await request(ctx.app).get('/api/mode')).body).toMatchObject({ mode: 'mock', liveReady: false });
  });

  it('is GET only', async () => {
    settingsFile('');
    expect((await request(mockApp().app).post('/api/info').send({})).status).toBe(404);
  });
});

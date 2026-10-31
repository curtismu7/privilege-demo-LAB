import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { config } from '../../src/config.js';
import { describe, expect, it } from 'vitest';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pd-app-'));

describe('createApp', () => {
  it('GET /api/health answers {ok:true}', async () => {
    const { createApp } = await import('../../src/app.js');
    const res = await request(createApp({ cfg: { ...config(), dataDir: tmp() } })).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  }, 30_000); // the first call pays for a cold import of the whole app; 5 s was too tight on a loaded runner

  it('unknown /api paths are 404 json', async () => {
    const { createApp } = await import('../../src/app.js');
    const res = await request(createApp({ cfg: { ...config(), dataDir: tmp() } })).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });

  it('serves web/dist and falls back to index.html for any path', async () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-dist-'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<title>fixture</title>');
    process.env.WEB_DIST = dist;
    try {
      const mod = await import('../../src/app.js?dist');
      const res = await request(mod.createApp({ cfg: { ...config(), dataDir: tmp() } })).get('/some/page');
      expect(res.status).toBe(200);
      expect(res.text).toContain('fixture');
    } finally { delete process.env.WEB_DIST; fs.rmSync(dist, { recursive: true }); }
  });
});

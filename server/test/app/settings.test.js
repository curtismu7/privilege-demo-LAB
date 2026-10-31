import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALLOWED, FORBIDDEN, loadSharedEnv, sharedEnvPath } from '../../src/settings.js';
import { tmpDir } from './helpers.js';
import path from 'node:path';

const write = (text, mode = 0o600) => {
  const file = path.join(tmpDir(), 'shared.env');
  fs.writeFileSync(file, text, { mode });
  fs.chmodSync(file, mode);
  return file;
};

describe('the shared settings loader', () => {
  it('STANDALONE_ENV names the file; otherwise it is ~/Development/.env', () => {
    expect(sharedEnvPath({ STANDALONE_ENV: '/x/y.env' })).toBe('/x/y.env');
    expect(sharedEnvPath({})).toMatch(/Development[\\/]\.env$/);
  });

  it('keeps only this app\'s keys, and real environment variables win', () => {
    const file = write('PF_URL=https://pf.example\nPF_AUDIENCE=aud-from-file\nPINGONE_ENVIRONMENT_ID=other-app\nPRIVILEGE_DEMO_MODE=live\nPACK=utility\n');
    const env = { PF_AUDIENCE: 'aud-from-env' };
    const r = loadSharedEnv({ env, file });
    expect(env).toEqual({ PF_AUDIENCE: 'aud-from-env', PF_URL: 'https://pf.example', DEMO_MODE: 'live', PACK: 'utility' });
    expect(r.loaded.sort()).toEqual(['DEMO_MODE', 'PACK', 'PF_URL']);
    expect(r.found).toBe(true);
    expect(r.modeOk).toBe(true);
  });

  it('never keeps admin or worker credentials: they are reported by name and dropped unread', () => {
    const file = write('PINGONE_ADMIN_CLIENT_ID=a\nPINGONE_ADMIN_CLIENT_SECRET=sentinel-secret-1\nWORKER_CLIENT_SECRET=sentinel-secret-2\nVAULT_PASSWORD=sentinel-secret-3\nPINGONE_CLIENT_SECRET=sentinel-secret-4\nSOME_OTHER_APPS_TOKEN=sentinel-secret-5\nPF_URL=https://pf.example\n');
    const env = {};
    const r = loadSharedEnv({ env, file });
    expect(env).toEqual({ PF_URL: 'https://pf.example' });
    expect(r.refused.sort()).toEqual(['PINGONE_ADMIN_CLIENT_ID', 'PINGONE_ADMIN_CLIENT_SECRET', 'PINGONE_CLIENT_SECRET', 'VAULT_PASSWORD', 'WORKER_CLIENT_SECRET']); // another app's own key is dropped without comment
    expect(JSON.stringify(r)).not.toContain('sentinel');
    for (const key of ALLOWED) expect(FORBIDDEN.test(key), key).toBe(false);
  });

  it('parses comments, quotes and export, and reports a file others can read', () => {
    const file = write('# a comment\nexport PF_URL="https://pf.example"  \nPF_AUDIENCE=aud # trailing\nnot a setting\n', 0o644);
    const env = {};
    const r = loadSharedEnv({ env, file });
    expect(env).toEqual({ PF_URL: 'https://pf.example', PF_AUDIENCE: 'aud' });
    expect(r.modeOk).toBe(false);
  });

  it('a missing file is normal: nothing loaded, nothing thrown', () => {
    const env = {};
    expect(loadSharedEnv({ env, file: path.join(tmpDir(), 'nope.env') })).toMatchObject({ found: false, loaded: [] });
    expect(env).toEqual({});
  });
});

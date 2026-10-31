import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { CAST_KEYS, DEFAULTS, VERTICALS, loadCustomerConfig, validateConfig } from '../../src/customer.js';
import { mockApp, tmpDir } from './helpers.js';

describe('customer.config (rule 12)', () => {
  it('no file means the defaults, silently', () => {
    const r = loadCustomerConfig({ file: path.join(tmpDir(), 'none.json'), env: {} });
    expect(r.config).toEqual(DEFAULTS);
    expect(r.warnings).toEqual([]);
  });
  it('takes a name, tagline, vertical, cast and vocabulary', () => {
    const { config, warnings } = validateConfig({ name: 'Harbor Agent Lab', tagline: 'Access that fits', vertical: 'banking', cast: { mark: 'Alex', priya: 'Sam' }, vocabulary: { org: 'the credit union' } });
    expect(warnings).toEqual([]);
    expect(config).toMatchObject({ name: 'Harbor Agent Lab', vertical: 'banking', cast: { mark: 'Alex', priya: 'Sam' }, vocabulary: { org: 'the credit union' } });
  });
  it('a bad field falls back to its default with a reason, never an exception', () => {
    const { config, warnings } = validateConfig({ name: '<b>x</b>', vertical: 'zoo', cast: { mark: '{{x}}', nobody: 'Zed', dana: '' }, vocabulary: 'no', extra: 1, tagline: 'a‮b' });
    expect(config).toEqual(DEFAULTS);
    expect(warnings.join('\n')).toMatch(/name: must be plain text/);
    expect(warnings.join('\n')).toMatch(/vertical: must be one of/);
    expect(warnings.join('\n')).toMatch(/cast.nobody: unknown key ignored/);
    expect(warnings.join('\n')).toMatch(/tagline: must be plain text/);
    expect(warnings.join('\n')).toMatch(/extra: unknown key ignored/);
  });
  it('a file that is not JSON, too big, or named but missing uses the defaults and says so', () => {
    const dir = tmpDir();
    const bad = path.join(dir, 'bad.json'); fs.writeFileSync(bad, '{nope');
    expect(loadCustomerConfig({ file: bad }).warnings[0]).toMatch(/not valid JSON/);
    const big = path.join(dir, 'big.json'); fs.writeFileSync(big, JSON.stringify({ name: 'x'.repeat(9000) }));
    expect(loadCustomerConfig({ file: big }).warnings[0]).toMatch(/larger than/);
    expect(loadCustomerConfig({ env: { CUSTOMER_CONFIG: path.join(dir, 'missing.json') } }).warnings[0]).toMatch(/could not be read/);
  });
  it('the shipped example file is valid and carries no real customer', () => {
    const file = new URL('../../../customer.config.example.json', import.meta.url);
    const r = loadCustomerConfig({ file: file.pathname });
    expect(r.warnings).toEqual([]);
    expect(r.config.name).not.toBe(DEFAULTS.name);
    expect(JSON.stringify(r.config)).toMatch(/\.example|Example|Harbor/);
  });
  it('is served to the page by /api/auth/config', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'c.json'); fs.writeFileSync(file, JSON.stringify({ name: 'Harbor Agent Lab', cast: { mark: 'Alex' } }));
    const ctx = mockApp({}, { customerFile: file });
    const r = await request(ctx.app).get('/api/auth/config');
    expect(r.body.customer).toMatchObject({ name: 'Harbor Agent Lab', cast: { mark: 'Alex' }, vertical: 'generic', warnings: [] });
  });
  it('the allowed verticals are the ones the page has', () => {
    expect(VERTICALS).toEqual(['generic', 'airlines', 'banking', 'utility']);
    expect(CAST_KEYS).toContain('priya');
  });
});

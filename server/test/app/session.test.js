// The session cookie must be found wherever it sits in the Cookie header. Other labs set cookies on 127.0.0.1/localhost, so the
// browser sends the session cookie after (or between) other cookies; it must be matched by exact name, never as a substring.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { cookieName, cookieValue, createSessions } from '../../src/auth/session.js';
import { mockApp } from './helpers.js';

const clock = { t: 1_700_000_000_000 };
const mk = () => createSessions({ secret: 'unit-test-secret', ttlMs: 60_000, now: () => clock.t });
const NAME = cookieName('default');

describe.each(['read', 'readAny'])('sessions.%s finds the cookie anywhere in the Cookie header', (fn) => {
  const sessions = mk();
  const value = sessions.issue('mark', 'default');
  const other = sessions.issue('mark', 'other'); // a validly signed cookie for another workspace
  const find = (header, ws = 'default') => sessions[fn](header, ws);

  it('alone (unchanged behaviour)', () => {
    expect(find(`${NAME}=${value}`)).toBe('mark');
  });
  it('first, with another cookie after it', () => {
    expect(find(`${NAME}=${value}; other=1`)).toBe('mark');
  });
  it('last, with another cookie before it (the reported bug)', () => {
    expect(find(`other=1; ${NAME}=${value}`)).toBe('mark');
  });
  it('in the middle, and with no space after the semicolon', () => {
    expect(find(`a=1; b=2; ${NAME}=${value}; c=3`)).toBe('mark');
    expect(find(`a=1;${NAME}=${value};c=3`)).toBe('mark');
  });
  it('a name that merely ends with the session cookie name is a different cookie', () => {
    expect(find(`x${NAME}=${value}`)).toBeNull();
    expect(find(`other=1; x${NAME}=${value}`)).toBeNull();
    expect(find(`other=1; x${NAME}=${value}; y=2`)).toBeNull();
  });
  it('a name that merely starts with the session cookie name is a different cookie', () => {
    expect(find(`${NAME}x=${value}`)).toBeNull();
    expect(find(`other=1; ${NAME}x=${value}`)).toBeNull();
  });
  it('workspace ids that are prefixes of each other do not read each other cookies', () => {
    const s = mk();
    const forA = s.issue('mark', 'a');
    const forAb = s.issue('mary', 'ab');
    const header = `${cookieName('a')}=${forA}; ${cookieName('ab')}=${forAb}`;
    expect(s[fn](header, 'a')).toBe('mark');
    expect(s[fn](header, 'ab')).toBe('mary');
    expect(s[fn](`${cookieName('ab')}=${forAb}`, 'a')).toBeNull();
  });
  it('the cookie name appearing inside another cookie value does not count', () => {
    expect(find(`other=${NAME}=${value}`)).toBeNull();
    expect(find(`other=${NAME}=${value}; third=3`)).toBeNull();
  });
  it('another cookie value containing "=" does not hide the session cookie', () => {
    expect(find(`pref=a=b==; ${NAME}=${value}`)).toBe('mark');
  });
  it('still rejects what it rejected before: no header, wrong workspace, bad signature, expired', () => {
    expect(find(undefined)).toBeNull();
    expect(find('')).toBeNull();
    expect(find(`other=1`)).toBeNull();
    expect(find(`other=1; ${NAME}=${other}`)).toBeNull(); // right signature, wrong workspace
    expect(find(`other=1; ${NAME}=${value.replace(/\.[^.]+$/, '.AAAA')}`)).toBeNull();
    expect(find(`other=1; ${NAME}=nodot`)).toBeNull();
    expect(find(`other=1; ${NAME}=`)).toBeNull();
    const old = sessions.issue('mark', 'default');
    clock.t += 61_000;
    try { expect(find(`other=1; ${NAME}=${old}`)).toBeNull(); } finally { clock.t -= 61_000; }
  });
});

describe('cookieValue', () => {
  it('matches the whole name only and returns the text after the first "="', () => {
    expect(cookieValue('a=1; b=2', 'b')).toBe('2');
    expect(cookieValue('a=1;b=2', 'a')).toBe('1');
    expect(cookieValue('ab=1; xa=2; a=3', 'a')).toBe('3');
    expect(cookieValue('a=b=c==; d=4', 'a')).toBe('b=c==');
    expect(cookieValue('  a  =  1  ;b=2', 'a')).toBe('1'); // whitespace around the name and value is trimmed
    expect(cookieValue('a=1; a=2', 'a')).toBe('1'); // the first one wins, as before
    expect(cookieValue('a=; a=2', 'a')).toBe('2'); // an empty value is skipped, as before
  });
  it('returns null for a missing cookie, a bare token, an empty value and non-string input', () => {
    for (const header of [undefined, null, '', ' ', 'a', 'a;b', 'a=', ';;;', 'b=1']) expect(cookieValue(header, 'a'), String(header)).toBeNull();
  });
});

describe('sessions.readAny keeps its live-principal shape', () => {
  it('returns { claims } for a live sign-in wherever the cookie sits', () => {
    const s = mk();
    const live = s.issueClaims({ sub: 'priya', groups: ['travel-agents'] }, 'default');
    expect(s.readAny(`other=1; ${NAME}=${live}`, 'default')).toEqual({ claims: { sub: 'priya', groups: ['travel-agents'] } });
    expect(s.read(`other=1; ${NAME}=${live}`, 'default')).toBeNull(); // read() is persona-only, as before
  });
});

describe('over HTTP: sign-in followed by /api/session with other cookies on the same host', () => {
  const signInCookie = async (ctx, headers = {}) =>
    (await request(ctx.app).post('/api/auth/mock/login').set(headers).send({ persona: 'mark' })).headers['set-cookie'][0].split(';')[0];

  it('/api/session and /api/me recognise the session when another cookie comes first, last or on both sides', async () => {
    const ctx = mockApp();
    const cookie = await signInCookie(ctx);
    for (const header of [cookie, `other=1; ${cookie}`, `${cookie}; other=1`, `lab=x; ${cookie}; theme=dark`]) {
      const session = await request(ctx.app).get('/api/session').set('cookie', header);
      expect(session.status, header).toBe(200);
      expect(session.body.me, header).toMatchObject({ sub: 'mark' });
      expect((await request(ctx.app).get('/api/me').set('cookie', header)).status, header).toBe(200);
    }
  });
  it('a workspace session is found behind other cookies too, and only for its own workspace', async () => {
    const ctx = mockApp();
    const cookie = await signInCookie(ctx, { 'x-workspace': 'team-a' });
    const header = `other=1; ${cookie}`;
    const own = await request(ctx.app).get('/api/session').set('x-workspace', 'team-a').set('cookie', header);
    expect(own.body.me).toMatchObject({ sub: 'mark' });
    const wrong = await request(ctx.app).get('/api/session').set('cookie', header); // default workspace
    expect(wrong.body).toEqual({ me: null });
  });
  it('a lookalike cookie name does not sign anyone in', async () => {
    const ctx = mockApp();
    const cookie = await signInCookie(ctx);
    const session = await request(ctx.app).get('/api/session').set('cookie', `other=1; x${cookie}`);
    expect(session.body).toEqual({ me: null });
    expect((await request(ctx.app).get('/api/me').set('cookie', `other=1; x${cookie}`)).status).toBe(401);
  });
});

// Signed cookie session (HMAC-SHA256) holding a persona id (mock) or a live principal {live:true, claims}, a workspace id and an expiry. No token is ever stored.
// One cookie per workspace (pd_session_<workspace>), so signing in to one workspace never signs anyone in to another.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const cookieName = (workspace) => `pd_session_${workspace}`;

// The value of the cookie called `name` in a Cookie header, or null. Splits on ";" and compares the whole name (so "xpd_session_a" is
// not "pd_session_a"); the value is everything after the first "=", so it may itself contain "=". The first non-empty match wins.
export function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    if (value) return value;
  }
  return null;
}

export function createSessions({ secret, ttlMs, now }) {
  const key = secret || randomBytes(32).toString('hex'); // no secret configured: sessions die with the process
  const sign = (b) => createHmac('sha256', key).update(b).digest('base64url');
  return {
    issue(persona, workspace) {
      const body = Buffer.from(JSON.stringify({ p: persona, w: workspace, e: now() + ttlMs })).toString('base64url');
      return `${body}.${sign(body)}`;
    },
    // Live sign-in: the verified claims come from a PF-verified access token, so they are safe to carry.
    issueClaims(claims, workspace) {
      const body = Buffer.from(JSON.stringify({ c: claims, w: workspace, e: now() + ttlMs })).toString('base64url');
      return `${body}.${sign(body)}`;
    },
    // Returns a persona id (string) or a live principal { claims } — the caller tells them apart with typeof.
    readAny(cookieHeader, workspace) {
      const raw = cookieValue(cookieHeader, cookieName(workspace));
      if (!raw) return null;
      const [body, sig] = raw.split('.');
      if (!body || !sig) return null;
      const want = Buffer.from(sign(body));
      const got = Buffer.from(sig);
      if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
      try {
        const v = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (v.w !== workspace || v.e <= now()) return null;
        if (v.c && typeof v.c === 'object' && typeof v.c.sub === 'string') return { claims: v.c };
        return typeof v.p === 'string' ? v.p : null;
      } catch { return null; }
    },
    read(cookieHeader, workspace) {
      const raw = cookieValue(cookieHeader, cookieName(workspace));
      if (!raw) return null;
      const [body, sig] = raw.split('.');
      if (!body || !sig) return null;
      const want = Buffer.from(sign(body));
      const got = Buffer.from(sig);
      if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
      try {
        const v = JSON.parse(Buffer.from(body, 'base64url').toString());
        return typeof v.p === 'string' && v.w === workspace && v.e > now() ? v.p : null;
      } catch { return null; }
    },
    cookie(value, maxAgeSec, workspace) {
      return `${cookieName(workspace)}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
    },
  };
}

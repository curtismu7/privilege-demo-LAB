// Signed cookie session (HMAC-SHA256) holding only a persona id and an expiry. No token is ever stored.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'pd_session';

export function createSessions({ secret, ttlMs, now }) {
  const key = secret || randomBytes(32).toString('hex'); // no secret configured: sessions die with the process
  const sign = (b) => createHmac('sha256', key).update(b).digest('base64url');
  return {
    issue(persona) {
      const body = Buffer.from(JSON.stringify({ p: persona, e: now() + ttlMs })).toString('base64url');
      return `${body}.${sign(body)}`;
    },
    read(cookieHeader) {
      const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookieHeader || '');
      if (!m) return null;
      const [body, sig] = m[1].split('.');
      if (!body || !sig) return null;
      const want = Buffer.from(sign(body));
      const got = Buffer.from(sig);
      if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
      try {
        const v = JSON.parse(Buffer.from(body, 'base64url').toString());
        return typeof v.p === 'string' && v.e > now() ? v.p : null;
      } catch { return null; }
    },
    cookie(value, maxAgeSec) {
      return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
    },
  };
}

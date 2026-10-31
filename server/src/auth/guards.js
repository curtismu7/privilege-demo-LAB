// Hard guards for the offline mock sign-in. Every refusal returns a stable code; none says anything about secrets.
import fs from 'node:fs';
import { isLoopbackHost } from '../config.js';

const PROXY_HEADERS = ['forwarded', 'true-client-ip', 'via'];
const PROXY_PREFIXES = ['x-forwarded-', 'cf-'];

export function proxyHeaderPresent(headers = {}) {
  return Object.keys(headers).some((raw) => {
    const h = raw.toLowerCase();
    return PROXY_HEADERS.includes(h) || PROXY_PREFIXES.some((p) => h.startsWith(p));
  });
}

const loopbackAddr = (a) => typeof a === 'string' && (a === '::1' || a.startsWith('127.') || a.startsWith('::ffff:127.'));

// Returns null when mock sign-in may be used for this request, else a refusal code.
// Config-level switches are separate (mock routes are not mounted at all without them).
export function mockRequestRefusal(req, cfg) {
  if (cfg.nodeEnv === 'production') return 'production';
  if (!cfg.mockSignin) return 'disabled';
  if (!isLoopbackHost(cfg.host)) return 'non_loopback_listener';
  if (!loopbackAddr(req.socket?.localAddress) || !loopbackAddr(req.socket?.remoteAddress)) return 'non_loopback_connection';
  if (proxyHeaderPresent(req.headers)) return 'proxy_header';
  const host = String(req.headers?.host || '').replace(/:\d+$/, '').toLowerCase();
  if (!isLoopbackHost(host)) return 'non_loopback_host';
  return null;
}

export const adminSwitchPresent = (cfg) => {
  try { return fs.statSync(cfg.adminSwitchFile).isFile(); } catch { return false; }
};

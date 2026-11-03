// Hard guards for the offline mock sign-in and the controls that change the demo (mode toggle, workspace reset).
// Every refusal returns a stable code; none says anything about secrets.
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
const hostName = (h) => String(h || '').replace(/:\d+$/, '').toLowerCase();

// The Host header's name is one of the names this app answers to (loopback always; LAB_ALLOWED_HOSTS adds more).
export const hostAllowed = (hostHeader, cfg) => {
  const name = hostName(hostHeader);
  return isLoopbackHost(name) || (cfg.allowedHosts ?? []).includes(name);
};

// Returns null when the request comes from this machine in the way a loopback-only demo expects, else a refusal code.
// Used by mock sign-in and by the controls that change the demo's state without a sign-in (mode toggle, workspace reset).
// In Docker (LAB_PUBLISH=loopback) the peer is the bridge gateway, not 127.0.0.1: the published port is loopback-only instead.
export function localRequestRefusal(req, cfg) {
  const published = cfg.publish === 'loopback';
  if (!isLoopbackHost(cfg.host) && !published) return 'non_loopback_listener';
  if (!published && (!loopbackAddr(req.socket?.localAddress) || !loopbackAddr(req.socket?.remoteAddress))) return 'non_loopback_connection';
  if (proxyHeaderPresent(req.headers)) return 'proxy_header';
  const host = hostName(req.headers?.host);
  // A LAB_ALLOWED_HOSTS name resolves to this machine too (the fleet's domain-name rule): it is as local as
  // loopback, and the connection checks above already proved the peer is this machine.
  if (!isLoopbackHost(host) && !(cfg.allowedHosts ?? []).includes(host)) return 'non_loopback_host';
  return null;
}

// Returns null when mock sign-in may be used for this request, else a refusal code (rule 11).
// Config-level switches are separate (mock routes are not mounted at all without ALLOW_MOCK_SIGNIN=1).
// NODE_ENV is not a guard: the Docker images set it.
export function mockRequestRefusal(req, cfg, mode = 'mock') {
  if (!cfg.mockSignin) return 'disabled';
  if (mode !== 'mock') return 'live_mode';
  return localRequestRefusal(req, cfg);
}

export const adminSwitchPresent = (cfg) => {
  try { return fs.statSync(cfg.adminSwitchFile).isFile(); } catch { return false; }
};

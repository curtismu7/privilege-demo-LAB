// The netguard: the one fetch this app is allowed to use. Every outbound request goes through fetchImpl().
//  - Mock mode: nothing leaves the process. Every request is refused before a socket opens and the real fetch is never called
//    (the mock issuer is in process, so nothing needs one).
//  - Live mode: only the origin of the configured PingFederate (PF_URL) may be reached, with no redirects followed and a time cap.
//    Anything else is refused before a socket opens.
// It counts attempts, so the self-test, the doctor and the tests can prove "zero".
export class NetguardRefused extends Error {}

export const LIVE_TIMEOUT_MS = 10_000;

export function createNetguard({ mode, liveOrigin, realFetch = globalThis.fetch, timeoutMs = LIVE_TIMEOUT_MS }) {
  const stats = { realAttempts: 0, refused: 0 };
  const refuse = (why) => { stats.refused += 1; throw new NetguardRefused(why); };

  async function fetchImpl(url, init = {}) {
    if (mode() !== 'live') refuse('Mock mode: no outbound calls');
    let target;
    try { target = new URL(typeof url === 'string' ? url : url.url ?? String(url)); } catch { return refuse('Not a URL'); }
    const origin = liveOrigin();
    if (!origin || target.origin !== origin) refuse('Live mode: only the configured PingFederate may be called');
    if (target.username || target.password) refuse('Outbound URLs must not carry credentials');
    stats.realAttempts += 1;
    return realFetch(target.toString(), { ...init, redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
  }

  // Proves the guard holds without touching the network: in mock mode even the configured PingFederate's own origin and a loopback
  // URL must be refused, and in either mode a URL on another origin must be refused, each with the real fetch not called.
  // Returns { ok, checks }; counters are restored.
  async function selfTest() {
    const before = { ...stats };
    const checks = [];
    const refused = async (url) => { try { await fetchImpl(url, { method: 'GET' }); return false; } catch (e) { return e instanceof NetguardRefused; } };
    checks.push({ name: 'a URL on another origin is refused', ok: await refused('https://other.invalid/') });
    if (mode() !== 'live') {
      checks.push({ name: 'mock mode refuses a loopback URL too', ok: await refused('http://127.0.0.1:9/') });
      const origin = liveOrigin();
      if (origin) checks.push({ name: 'mock mode refuses even the configured PingFederate origin', ok: await refused(`${origin}/pf/JWKS`) });
    }
    checks.push({ name: 'the real fetch was never called', ok: stats.realAttempts === before.realAttempts });
    Object.assign(stats, before);
    return { ok: checks.every((c) => c.ok), checks };
  }

  return { fetchImpl, selfTest, stats: () => ({ ...stats }) };
}

import { useEffect, useState } from "react";
import { PERSONAS, api } from "../api";
import { useSession } from "../session";
import { usePack } from "../pack";
import { useCastName } from "../customer";
import PreflightCard from "../components/PreflightCard";

const PERSONA_LINES = {
  mark: "Traveler in travel-agents. His agent Dot books fares.",
  mary: "Analyst in analysts. Search and Ticketing, not Payments.",
  priya: "Approver in travel-agents. Answers held calls.",
  dana: "Admin in admins. Edits policies, makes a tool drift.",
};

const MOCK_REFUSALS = {
  disabled: "Set ALLOW_MOCK_SIGNIN=1 to allow it (npm start does, on a loopback bind; docker-compose.yml does), then restart.",
  non_loopback_listener: "The app is listening on a non-loopback address, so the persona picker is refused. Run it on 127.0.0.1.",
  non_loopback_connection: "This request did not come from this machine.",
  proxy_header: "This request came through a proxy (it carries forwarding headers), so the persona picker is refused.",
  non_loopback_host: "This page was reached by a name that is not loopback.",
};

/** Sign-in. Host-run offline mock: a persona picker. Server in pf mode: Bearer token guidance. */
export default function HomePage() {
  const { status, me, config, signIn, liveSignIn } = useSession();
  const pack = usePack();
  const castName = useCastName();
  const [personas, setPersonas] = useState(null);
  const [problem, setProblem] = useState("");

  // The persona list also says which personas exist (Dana only with the admin switch file).
  useEffect(() => {
    if (status !== "anon" || !config?.mockAvailable) return;
    api("/api/auth/mock/personas").then((r) => setPersonas(r.ok ? r.data.personas : []));
  }, [status, config]);

  const pick = async (id) => {
    setProblem("");
    const r = await signIn(id);
    if (!r.ok) setProblem(`Sign-in refused (${r.data?.reason ?? r.data?.error ?? r.status}).`);
  };

  if (status === "loading") return <main className="page"><p role="status">Loading…</p></main>;

  return (
    <main className="page signin">
      <h1>Privilege demo LAB</h1>
      <p className="lede">An AI agent's MCP tool calls pass through a policy enforcement point that decides allow, deny or hold with Cedar.</p>

      {!me && <PreflightCard />}
      {me ? (
        <section className="card" aria-label="Signed in">
          <h2>You are signed in</h2>
          <p>{castName(me.persona, me.name ?? PERSONAS[me.persona]?.name ?? me.sub)}, groups: {me.groups.join(", ") || "none"}{me.source === "bearer" ? " (Bearer token)" : ""}.</p>
          <p className="muted">Next: the <a href="/console">Tool console</a> to make a call, <a href="/policies">AI Policies</a> to read or test the rules, <a href="/learn">Learn</a> for the stories.</p>
        </section>
      ) : config?.mockAvailable ? (
        <section className="card" aria-labelledby="pick-h">
          <h2 id="pick-h">Pick a persona</h2>
          <p className="muted">Offline mock sign-in. No password, no network. Mock mode only.</p>
          {(personas ?? (pack.personas ?? Object.keys(PERSONAS).map((id) => ({ id, ...PERSONAS[id] }))).filter((p) => p.id !== "dana")).map((p) => (
            <button key={p.id} type="button" className="persona-button" onClick={() => pick(p.id)}>
              <span><strong>{castName(p.id, p.name)}</strong> <span className="muted">{(pack.personas ?? []).find((x) => x.id === p.id)?.line ?? PERSONA_LINES[p.id]}</span></span>
              <span aria-hidden="true">Sign in</span>
            </button>
          ))}
          {personas && !personas.some((p) => p.id === "dana") && (
            <p className="muted">Dana (admin) is hidden: the host has not created the admin switch file <code>ALLOW_ADMIN_PERSONA</code> in the data directory.</p>
          )}
          {problem && <p role="alert" className="problems">{problem}</p>}
          <ul className="guards" aria-label="Mock sign-in guards">
            <li>Mock sign-in works only on this machine: a loopback listener (or a port Docker publishes on 127.0.0.1 only), no proxy headers, a loopback Host.</li>
            <li>It is refused in Live mode.</li>
          </ul>
        </section>
      ) : config?.mode === "mock" ? (
        <section className="card" aria-labelledby="off-h">
          <h2 id="off-h">Mock sign-in is off</h2>
          <p>{MOCK_REFUSALS[config.mockRefusal] ?? "Mock sign-in is not available for this request."}</p>
        </section>
      ) : config?.liveSignin ? (
        <LiveSignInCard liveSignIn={liveSignIn} />
      ) : (
        <section className="card" aria-labelledby="bearer-h">
          <h2 id="bearer-h">Bearer token</h2>
          <p>Live mode: this server verifies PingFederate access tokens{config?.bearer ? "" : " (not configured here)"}. There is no persona picker in this mode.</p>
          <p>Send the token as <code>Authorization: Bearer &lt;access token&gt;</code> to <code>POST /mcp</code> or the <code>/api</code> routes. The token's <code>groups</code> claim decides what the policies allow. This page never asks for or stores a token.</p>
          <p className="muted">To use this web UI with a persona, switch the header to Mock.</p>
        </section>
      )}
    </main>
  );
}


// Live sign-in: a real PingFederate pi.flow login driven server-side. The username and password go to
// PingFederate's Authentication API and are never stored; the returned token is verified against the PF JWKS
// before the session is issued. Shown only when the server says the sign-in client is configured.
function LiveSignInCard({ liveSignIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setProblem("");
    const r = await liveSignIn(username, password);
    setBusy(false);
    if (!r.ok) setProblem(`Sign-in refused (${r.data?.reason ?? r.data?.error ?? r.status}).`);
  };
  return (
    <section className="card" aria-labelledby="live-signin-h">
      <h2 id="live-signin-h">Sign in with PingFederate</h2>
      <p className="muted">Live mode: the sign-in runs through PingFederate's Authentication API (pi.flow, no redirect). The token is verified against the PingFederate JWKS before the session is issued; the password is never stored.</p>
      <form onSubmit={submit} aria-label="Live sign-in">
        <label className="inline" htmlFor="live-user">Username<input id="live-user" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={256} required /></label>
        <label className="inline" htmlFor="live-pass">Password<input id="live-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={1024} required /></label>
        <button type="submit" className="primary" disabled={busy || !username || !password}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      {problem && <p role="alert" className="problems">{problem}</p>}
    </section>
  );
}

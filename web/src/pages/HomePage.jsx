import { useEffect, useState } from "react";
import { PERSONAS, api } from "../api";
import { useSession } from "../session";
import { usePack } from "../pack";
import PreflightCard from "../components/PreflightCard";

const PERSONA_LINES = {
  mark: "Traveler in travel-agents. His agent Dot books fares.",
  mary: "Analyst in analysts. Search and Ticketing, not Payments.",
  priya: "Approver in travel-agents. Answers held calls.",
  dana: "Admin in admins. Edits policies, makes a tool drift.",
};

/** Sign-in. Host-run offline mock: a persona picker. Server in pf mode: Bearer token guidance. */
export default function HomePage() {
  const { status, me, config, signIn } = useSession();
  const pack = usePack();
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
          <p>{me.name ?? PERSONAS[me.persona]?.name ?? me.sub}, groups: {me.groups.join(", ") || "none"}{me.source === "bearer" ? " (Bearer token)" : ""}.</p>
          <p className="muted">Next: the <a href="/console">Tool console</a> to make a call, <a href="/policies">AI Policies</a> to read or test the rules, <a href="/learn">Learn</a> for the stories.</p>
        </section>
      ) : config?.mockAvailable ? (
        <section className="card" aria-labelledby="pick-h">
          <h2 id="pick-h">Pick a persona</h2>
          <p className="muted">Offline mock sign-in for a host-run demo. No password, no network.</p>
          {(personas ?? (pack.personas ?? Object.keys(PERSONAS).map((id) => ({ id, ...PERSONAS[id] }))).filter((p) => p.id !== "dana")).map((p) => (
            <button key={p.id} type="button" className="btn persona" onClick={() => pick(p.id)}>
              <span><strong>{p.name}</strong> <span className="muted">{(pack.personas ?? []).find((x) => x.id === p.id)?.line ?? PERSONA_LINES[p.id]}</span></span>
              <span aria-hidden="true">Sign in</span>
            </button>
          ))}
          {personas && !personas.some((p) => p.id === "dana") && (
            <p className="muted">Dana (admin) is hidden: the host has not created the admin switch file <code>ALLOW_ADMIN_PERSONA</code> in the data directory.</p>
          )}
          {problem && <p role="alert" className="problems">{problem}</p>}
          <ul className="guards" aria-label="Mock sign-in guards">
            <li>Mock sign-in is on only for this loopback, host-run server.</li>
            <li>Docker containers never offer it.</li>
          </ul>
        </section>
      ) : (
        <section className="card" aria-labelledby="bearer-h">
          <h2 id="bearer-h">Bearer token</h2>
          <p>This server verifies PingFederate access tokens{config?.bearer ? "" : " (not configured here)"}. There is no mock persona picker in this mode.</p>
          <p>Send the token as <code>Authorization: Bearer &lt;access token&gt;</code> to <code>POST /mcp</code> or the <code>/api</code> routes. The token's <code>groups</code> claim decides what the policies allow. This page never asks for or stores a token.</p>
          <p className="muted">To use this web UI with a persona, run the server on your own machine with <code>IDP=local-mock</code> and <code>ALLOW_MOCK_SIGNIN=1</code>.</p>
        </section>
      )}
    </main>
  );
}

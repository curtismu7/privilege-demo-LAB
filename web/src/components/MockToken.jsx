import { useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { usePack } from "../pack";

// Mock mode only: a mock access token for the signed-in person, so the /mcp door can be tried from a terminal with no PingFederate.
// Shown whole (rule 4: mock tokens are raw) and labelled mock. It is signed by the in-process mock issuer and only this app accepts it.
export default function MockToken() {
  const { config, me } = useSession();
  const pack = usePack();
  const [asAgent, setAsAgent] = useState(pack.agent.defaultOn);
  const [out, setOut] = useState(null);
  const [problem, setProblem] = useState("");
  if (config?.mode !== "mock" || me?.source !== "session") return null;
  const get = async () => {
    setProblem("");
    const r = await api("/api/mock/token", { method: "POST", body: { asAgent } });
    if (r.ok) setOut(r.data); else { setOut(null); setProblem(`No token (${r.data?.reason ?? r.data?.error ?? r.status}).`); }
  };
  return (
    <section className="card" aria-labelledby="token-h">
      <h2 id="token-h">Mock token for the MCP door</h2>
      <p className="muted">Mock mode only. A token for {me.sub}, signed by the in-process mock issuer (not PingFederate), for trying <code>POST /mcp</code> from a terminal.</p>
      <label className="check"><input type="checkbox" checked={asAgent} onChange={(e) => setAsAgent(e.target.checked)} />{pack.agent.label}</label>
      <div className="row"><button type="button" onClick={get}>Get a mock token</button></div>
      {problem && <p role="alert" className="problems">{problem}</p>}
      {out && (
        <div aria-live="polite">
          <p><strong>MOCK TOKEN</strong> <span className="muted">{out.label}</span></p>
          <pre className="result__body token-box" aria-label="Mock access token">{out.access_token}</pre>
          <pre className="result__body" aria-label="Example call">{`curl -s ${window.location.origin}/mcp \\
  -H 'authorization: Bearer <the token above>' -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}</pre>
        </div>
      )}
    </section>
  );
}

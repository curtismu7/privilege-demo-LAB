import { useCallback, useEffect, useState } from "react";
import { PERSONAS, api } from "../api";
import { usePack } from "../pack";
import { useSession } from "../session";
import ArgFields, { defaultArgs } from "../components/ArgFields";
import Badge from "../components/Badge";
import MockToken from "../components/MockToken";
import RequireSignIn from "../components/RequireSignIn";
import ResultCard from "../components/ResultCard";
import { PageStories } from "../story/StoryPanel";

function Console() {
  const { me } = useSession();
  const pack = usePack();
  const name = me?.name ?? PERSONAS[me?.persona]?.name ?? me?.sub;
  const startTool = pack.id === "generic" ? "search_flights" : pack.toolNames[0];
  const [tools, setTools] = useState([]);
  const [toolName, setToolName] = useState(startTool);
  const [args, setArgs] = useState(defaultArgs({ name: startTool }, pack.argDefaults));
  const [asAgent, setAsAgent] = useState(pack.agent.defaultOn);
  const [justification, setJustification] = useState("");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const loadTools = useCallback(async () => { const r = await api("/api/tools"); if (r.ok) setTools(r.data.tools); }, []);
  useEffect(() => { loadTools(); }, [loadTools]);
  const tool = tools.find((t) => t.name === toolName);

  const pickTool = (n) => { setToolName(n); setArgs(defaultArgs({ name: n }, pack.argDefaults)); setRes(null); };
  const call = async () => {
    setBusy(true);
    const body = { tool: toolName, args, ...(asAgent ? { asAgent: true } : {}), ...(justification.trim() ? { justification: justification.trim() } : {}) };
    const r = await api("/api/tools/call?envelope=1", { method: "POST", body });
    setRes(r.data && r.data.outcome ? r.data : { outcome: "error", rule: "request-failed", reason: r.data?.error ?? `HTTP ${r.status}`, overridden: [] });
    setBusy(false);
  };
  const drift = async (t) => {
    const r = await api("/api/admin/drift", { method: "POST", body: { tool: t.name, on: !t.drifted } });
    setNote(r.ok ? `${t.name} schema ${t.drifted ? "restored" : "drifted"}.` : `Could not change the schema (${r.data?.error ?? r.status}).`);
    await loadTools();
  };

  return (
    <main className="page">
      <h1>Tool console</h1>
      <p className="lede">Make a tool call as <strong>{name}</strong>. It goes through the policy enforcement point, which asks Cedar and then runs the tool, refuses it, or holds it for a person.</p>
      <PageStories page="console" />
      <div className="cols">
        <section className="card" aria-labelledby="call-h">
          <h2 id="call-h">Call a tool</h2>
          <label className="field">Tool
            <select value={toolName} onChange={(e) => pickTool(e.target.value)}>
              {(tools.length ? tools.map((t) => t.name) : [toolName]).map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <ArgFields tool={tool} args={args} onChange={setArgs} />
          <label className="check"><input type="checkbox" checked={asAgent} onChange={(e) => setAsAgent(e.target.checked)} />{pack.agent.label}</label>
          <label className="field">Justification (shown to an approver; never read by the policy)
            <input type="text" maxLength={500} value={justification} onChange={(e) => setJustification(e.target.value)} />
          </label>
          <div className="row"><button type="button" className="primary" onClick={call} disabled={busy || !tool}>Call as {name}</button></div>
          <div aria-live="polite"><ResultCard title="PEP decision" res={res} /></div>
        </section>

        <section className="card" aria-labelledby="tools-h">
          <h2 id="tools-h">Tools the server offers</h2>
          <ul className="list">
            {tools.map((t) => (
              <li key={t.name} className="list-item list-item--static">
                <code>{t.name}</code> <span className="muted">app: {t.app}</span>{t.mock && <Badge kind="group">Mock backend</Badge>}
                <Badge kind={t.drifted ? "deny" : "allow"}>{t.drifted ? "Schema drifted" : "Schema pinned"}</Badge>
                <span className="list-item__why">{t.description}</span>
                <span className="list-item__why mono">pinned {t.pinnedHash.slice(0, 10)} · observed {t.observedHash.slice(0, 10)}</span>
                <button type="button" disabled={!me?.isAdmin} onClick={() => drift(t)}>
                  {t.drifted ? "Restore schema" : "Make schema drift"}
                </button>
              </li>
            ))}
          </ul>
          {!me?.isAdmin && <p className="muted">Only an admin (Dana) can make a tool's schema drift. Anyone can preview it with the schema-changed box in Test a request.</p>}
          <p role="status" className="muted">{note}</p>
        </section>
      </div>
      <MockToken />
    </main>
  );
}

export default function ConsolePage() {
  return <RequireSignIn><Console /></RequireSignIn>;
}

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import Badge from "../components/Badge";
import MappingTable from "../components/MappingTable";
import RequireSignIn from "../components/RequireSignIn";
import TestRequest from "../components/TestRequest";
import { PageStories } from "../story/StoryPanel";

const TEMPLATE = `@reason("Say why this rule exists")
permit (principal in Group::"analysts", action == Action::"mcp:Invoke", resource)
when { context.app == "search" };
`;
const keyOf = (p) => `${p.state}:${p.id}`;
const problemText = (p) => (p.policyId ? `${p.policyId}: ${p.message}` : p.message);

function Policies() {
  const { me } = useSession();
  const admin = Boolean(me?.isAdmin);
  const [policies, setPolicies] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [sel, setSel] = useState(null); // keyOf(policy), or "new"
  const [newId, setNewId] = useState("");
  const [text, setText] = useState("");
  const [problems, setProblems] = useState(null);
  const [message, setMessage] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    const r = await api("/api/policies");
    if (r.ok) { setPolicies(r.data.policies); setLoadError(r.data.error); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const current = policies.find((p) => keyOf(p) === sel);
  const id = sel === "new" ? newId.trim() : current?.id ?? "";
  const open = (p) => { setSel(keyOf(p)); setText(p.text); setProblems(null); setMessage(""); };
  const startNew = () => { setSel("new"); setNewId(""); setText(TEMPLATE); setProblems(null); setMessage(""); };
  const changed = () => { setVersion((v) => v + 1); return load(); };

  const validate = async () => {
    const r = await api("/api/policies/validate", { method: "POST", body: { id, text } });
    setProblems(r.ok ? r.data.problems : [{ message: r.data?.error ?? `HTTP ${r.status}` }]);
    setMessage(r.ok && r.data.ok ? "Valid: the policy passes the Cedar schema check." : "");
  };
  const save = async (state) => {
    const r = await api(`/api/policies/${encodeURIComponent(id)}`, { method: "PUT", body: { text, state } });
    if (r.ok) {
      setProblems(null); setMessage(`Saved ${id} as ${state}.`); setSel(`${state}:${id}`); await changed();
    } else {
      setProblems(r.data?.problems ?? [{ message: r.data?.error ?? `HTTP ${r.status}` }]); setMessage("Not saved.");
    }
  };
  const remove = async () => {
    const r = await api(`/api/policies/${encodeURIComponent(id)}?state=${current.state}`, { method: "DELETE" });
    if (r.ok) { setSel(null); setText(""); setProblems(null); setMessage(`Deleted ${id} (${current.state}).`); await changed(); }
    else { setProblems(r.data?.problems ?? [{ message: r.data?.error ?? `HTTP ${r.status}` }]); setMessage("Not deleted."); }
  };
  const reset = async () => {
    setConfirmReset(false);
    const r = await api("/api/reset", { method: "POST" });
    if (r.ok) { setSel(null); setText(""); setProblems(null); setMessage("Demo reset: shipped policies restored, approvals, drift and trace cleared."); await changed(); }
    else setMessage(`Reset failed (${r.data?.error ?? r.status}).`);
  };

  const editing = sel !== null;
  return (
    <main className="page">
      <h1>AI Policies</h1>
      <p className="lede">Cedar policies decide every tool call: allow, deny, or hold for a person. A forbid beats a permit; anything no permit covers is denied.</p>
      <PageStories page="policies" />
      {loadError && <p role="alert" className="problems">The active policy set is broken, so every call is denied: {loadError.map(problemText).join("; ")}</p>}

      <div className="cols">
        <div>
          <section className="card" aria-labelledby="list-h">
            <h2 id="list-h">Policies</h2>
            <ul className="list">
              {policies.map((p) => (
                <li key={keyOf(p)}>
                  <button type="button" className="list-item" aria-current={keyOf(p) === sel ? "true" : undefined} onClick={() => open(p)}>
                    <code>{p.id}</code>
                    <Badge kind={p.state}>{p.state === "active" ? "Active" : "Candidate"}</Badge>
                    <Badge kind={p.effect ?? "error"}>{p.effect ?? "?"}</Badge>
                    <span className="list-item__why">{p.reason}{p.approvers ? ` · approvers: ${p.approvers}` : ""}</span>
                  </button>
                </li>
              ))}
              {policies.length === 0 && <li className="muted">No policies loaded.</li>}
            </ul>
            {admin && (
              <div className="row">
                <button type="button" onClick={startNew}>New policy</button>
                {confirmReset
                  ? <><button type="button" className="primary" onClick={reset}>Confirm reset</button><button type="button" onClick={() => setConfirmReset(false)}>Cancel</button></>
                  : <button type="button" onClick={() => setConfirmReset(true)}>Reset demo</button>}
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="edit-h">
            <h2 id="edit-h">Policy editor</h2>
            {!admin && <p className="muted">Read only: only an admin (Dana) can edit policies.</p>}
            {!editing ? <p className="muted">Select a policy to read it.</p> : (
              <>
                {sel === "new" && (
                  <label className="field">Policy id
                    <input type="text" value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="e.g. my-policy" />
                  </label>
                )}
                <label className="field" htmlFor="policy-text">Cedar text{current ? ` for ${current.id}` : ""}</label>
                <textarea id="policy-text" className="editor" spellCheck={false} value={text} readOnly={!admin} onChange={(e) => setText(e.target.value)} />
                {admin && (
                  <div className="row">
                    <button type="button" onClick={validate} disabled={!id}>Validate</button>
                    <button type="button" className="primary" onClick={() => save("active")} disabled={!id}>Save as Active</button>
                    <button type="button" onClick={() => save("candidate")} disabled={!id}>Save as Candidate</button>
                    {current && <button type="button" onClick={remove}>Delete {current.state}</button>}
                  </div>
                )}
              </>
            )}
            <p role="status" className="muted">{message}</p>
            {problems?.length > 0 && (
              <ul className="problems" aria-label="Validation problems" role="alert">
                {problems.map((p, i) => <li key={i}>{problemText(p)}</li>)}
              </ul>
            )}
            <p className="muted">A Candidate is shadow-evaluated in Test a request and never decides a live call.</p>
          </section>
        </div>
        <TestRequest />
      </div>
      <MappingTable version={version} />
    </main>
  );
}

export default function PoliciesPage() {
  return <RequireSignIn><Policies /></RequireSignIn>;
}

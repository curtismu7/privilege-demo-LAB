import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { usePack } from "../pack";
import Badge from "../components/Badge";
import RequireSignIn from "../components/RequireSignIn";
import { PageStories } from "../story/StoryPanel";

const POLL_MS = 3000;

function Approvals() {
  const { me } = useSession();
  const pack = usePack();
  const [items, setItems] = useState(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => { const r = await api("/api/approvals"); if (r.ok) setItems(r.data.approvals); }, []);
  useEffect(() => { load(); const t = setInterval(load, POLL_MS); return () => clearInterval(t); }, [load]);

  const mayDecide = (a) => a.status === "pending" && a.requester.sub !== me.sub && (me.isAdmin || a.approvers.includes(me.sub));
  const decide = async (a, verb) => {
    const r = await api(`/api/approvals/${a.id}/${verb}`, { method: "POST" });
    setMessage(r.ok ? `${verb === "approve" ? "Approved" : "Denied"} the ${a.tool} request.` : `Could not ${verb} (${r.data?.error ?? r.status}).`);
    await load();
  };

  return (
    <main className="page">
      <h1>Approvals</h1>
      <p className="lede">Calls the policies held for a person. Approving re-checks the call against the current policies and runs it once.</p>
      <PageStories page="approvals" />
      <div className="row"><button type="button" className="btn" onClick={load}>Refresh</button><span className="muted">Updates every few seconds.</span></div>
      <p role="status" className="muted">{message}</p>
      {items === null ? <p role="status">Loading…</p> : items.length === 0 ? (
        <p className="card">Nothing waiting. Make a held call in the <a href="/console">Tool console</a>: {pack.approvalsHint ?? "book_fare, amount 2400, with Dot making the call."}</p>
      ) : (
        <ul className="list" aria-label="Approval requests">
          {items.map((a) => (
            <li key={a.id} className="card">
              <h2><code>{a.tool}</code> <Badge kind={a.status} /></h2>
              <dl className="result__facts">
                <dt>Arguments</dt><dd><code>{JSON.stringify(a.args)}</code></dd>
                <dt>Asked by</dt><dd>{a.requester.sub}{a.requester.actor ? ` (through ${a.requester.actor})` : ""}</dd>
                <dt>Held by</dt><dd><code>{a.policy.rule}</code> {a.policy.reason}</dd>
                <dt>Approvers</dt><dd>{a.approvers.join(", ")}</dd>
                {a.justification && (<><dt>Justification</dt><dd>{a.justification}</dd></>)}
                <dt>Expires</dt><dd>{new Date(a.expiresAt).toLocaleTimeString()}</dd>
                {a.outcome && (<><dt>Outcome</dt><dd><Badge kind={a.outcome.decision} /> {a.outcome.reason}{a.decidedBy ? ` (${a.decidedBy})` : ""}{a.outcome.executed ? ", the tool ran" : ", the tool did not run"}</dd></>)}
              </dl>
              {a.outcome?.result && <pre className="result__body" aria-label="Tool result">{JSON.stringify(a.outcome.result, null, 2)}</pre>}
              {mayDecide(a) ? (
                <div className="row">
                  <button type="button" className="btn primary" onClick={() => decide(a, "approve")}>Approve {a.tool}</button>
                  <button type="button" className="btn" onClick={() => decide(a, "deny")}>Deny {a.tool}</button>
                </div>
              ) : a.status === "pending" && (
                <p className="muted">{a.requester.sub === me.sub ? "You asked for this; someone else has to answer it." : "Only the named approvers can answer this."}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default function ApprovalsPage() {
  return <RequireSignIn><Approvals /></RequireSignIn>;
}

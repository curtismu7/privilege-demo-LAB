import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { usePack } from "../pack";
import Badge from "../components/Badge";
import Explanation from "../components/Explanation";
import Json from "../components/JsonPane";
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
  const expire = async (a) => {
    const r = await api(`/api/approvals/${a.id}/expire`, { method: "POST" });
    setMessage(r.ok ? `The ${a.tool} request expired; the call stays denied.` : `Could not expire it (${r.data?.error ?? r.status}).`);
    await load();
  };

  return (
    <main className="page">
      <h1>Approvals</h1>
      <p className="lede">Calls the policies held for a person. Approving re-checks the call against the current policies and runs it once.</p>
      <PageStories page="approvals" />
      <div className="row"><button type="button" className="primary" onClick={load}>Refresh</button><span className="muted">Updates every few seconds.</span></div>
      <p role="status" className="muted">{message}</p>
      {items === null ? <p role="status">Loading…</p> : items.length === 0 ? (
        <p className="card">Nothing waiting. Make a held call in the <a href="/console">Tool console</a>: {pack.approvalsHint ?? "book_fare, amount 2400, with Dot making the call."}</p>
      ) : (
        <ul className="list" aria-label="Approval requests">
          {items.map((a) => (
            <li key={a.id} className="card">
              <h2><code>{a.tool}</code> <Badge kind={a.status} /></h2>
              <dl className="result__facts">
                <dt>Arguments</dt><dd><Json value={a.args} label="Arguments" hot={["amount"]} /></dd>
                <dt>Asked by</dt><dd>{a.requester.sub}{a.requester.actor ? ` (through ${a.requester.actor})` : ""}</dd>
                <dt>Held by</dt><dd><code>{a.policy.rule}</code> {a.policy.reason}</dd>
                <dt>Approvers</dt><dd>{a.approvers.join(", ")}</dd>
                {a.justification && (<><dt>Justification</dt><dd>{a.justification}</dd></>)}
                <dt>Expires</dt><dd>{new Date(a.expiresAt).toLocaleTimeString()}</dd>
                {a.outcome && (<><dt>Outcome</dt><dd><Badge kind={a.outcome.decision} /> {a.outcome.reason}{a.decidedBy ? ` (${a.decidedBy})` : ""}{a.outcome.executed ? ", the tool ran" : ", the tool did not run"}</dd></>)}
              </dl>
              {(a.outcome?.explanation ?? a.explanation) && (
                <details className="approval__why" open>
                  <summary>{a.outcome?.explanation ? "Why it ended this way" : "Why this was held"}</summary>
                  <Explanation explanation={a.outcome?.explanation ?? a.explanation} />
                </details>
              )}
              {a.outcome?.result && <Json value={a.outcome.result} label="Tool result" hot={["status", "amount", "env", "merged", "deployed"]} />}
              {mayDecide(a) ? (
                <>
                <p className="muted">If you approve, the rules are checked again with one approval recorded and the tool runs once.</p>
                <div className="row">
                  <button type="button" onClick={() => decide(a, "approve")}>Approve {a.tool}</button>
                  <button type="button" onClick={() => decide(a, "deny")}>Deny {a.tool}</button>
                </div>
                </>
              ) : a.status === "pending" && (
                <p className="muted">
                  {a.requester.sub === me.sub ? "You asked for this; someone else has to answer it." : "Only the named approvers can answer this."}{" "}
                  <button type="button" className="linkish" onClick={() => expire(a)}>Let it expire</button>
                </p>
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

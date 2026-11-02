import Badge from "./Badge";
import Explanation from "./Explanation";

// One decision, as the PEP or the test panel returned it: outcome, deciding policy and its reason, what it overrode.
export default function ResultCard({ title, res, children }) {
  if (!res) return null;
  // With the server's explanation, the plain-English card leads and the raw facts fold into "Technical details". Without one (an older
  // server, a failed request) the card is the original facts list.
  const ex = res.explanation && !res.explanation.error && res.explanation.v === 1 ? res.explanation : null;
  const outcome = ex ? ex.outcome : res.outcome ?? res.decision;
  const overridden = res.overridden ?? [];
  const facts = (
      <dl className="result__facts">
        <dt>Deciding policy</dt><dd><code>{res.rule}</code></dd>
        <dt>Reason</dt><dd>{res.reason}</dd>
        {res.attribution && (<><dt>On behalf of</dt><dd>user <code>{res.attribution.user}</code>{res.attribution.agent ? <> via agent <code>{res.attribution.agent}</code></> : " (no agent)"} · tool <code>{res.attribution.tool}</code></dd></>)}
        {res.rules?.length > 1 && (<><dt>All forbids that fired</dt><dd>{res.rules.map((r) => <code key={r}>{r}</code>)}</dd></>)}
        <dt>Overridden policies</dt>
        <dd>{overridden.length ? overridden.map((r) => <code key={r}>{r}</code>) : "none"}</dd>
        {res.approvers?.length > 0 && (<><dt>Approvers</dt><dd>{res.approvers.join(", ")}</dd></>)}
        {res.approvalId && (<><dt>Approval</dt><dd><a href="/approvals">Open Approvals</a> <code>{res.approvalId.slice(0, 8)}</code></dd></>)}
      </dl>
  );
  return (
    <section className="result" data-state={outcome} aria-label={title}>
      <h3 className="result__head">{ex ? "Decision" : title} {ex && <small className="muted result__gloss">(checked by the PEP, the decision checkpoint every call passes through)</small>} <Badge kind={outcome} /></h3>
      {ex ? (
        <>
          <Explanation explanation={ex} showTechnical={false} />
          <details className="explain__tech"><summary>Technical details</summary>{facts}</details>
        </>
      ) : facts}
      {res.problems?.length > 0 && (
        <ul className="problems" aria-label="Problems">
          {res.problems.map((p, i) => <li key={i}>{typeof p === "string" ? p : p.message}</li>)}
        </ul>
      )}
      {res.result && <pre className="result__body" aria-label="Tool result">{JSON.stringify(res.result, null, 2)}</pre>}
      {children}
    </section>
  );
}

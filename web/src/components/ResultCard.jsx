import Badge from "./Badge";

// One decision, as the PEP or the test panel returned it: outcome, deciding policy and its reason, what it overrode.
export default function ResultCard({ title, res, children }) {
  if (!res) return null;
  const outcome = res.outcome ?? res.decision;
  const overridden = res.overridden ?? [];
  return (
    <section className={`result result-${outcome}`} aria-label={title}>
      <h3 className="result__head">{title} <Badge kind={outcome} /></h3>
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

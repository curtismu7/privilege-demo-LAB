import Badge from "./Badge";
import { outcomeWord } from "../policyExamples";

const KIND_BADGE = { allow: "allow", block: "deny", hold: "hold" };

/** The one-line meaning chips of a policy row: Allow / Block / Hold rule, with the Cedar word as a small second label. */
export function KindBadge({ meaning }) {
  if (!meaning?.kind) return null;
  return (
    <>
      <Badge kind={KIND_BADGE[meaning.kind]}>{meaning.kindLabel}</Badge>
      <span className="muted policy-cedar">({meaning.cedar})</span>
    </>
  );
}

function Row({ label, children }) {
  return <><dt>{label}</dt><dd>{children}</dd></>;
}

/** "What this rule means": the structured meaning, plus up to two computed examples. `preview` marks unsaved editor text. */
export default function PolicyMeaning({ meaning: m, examples = [], preview = false }) {
  if (!m) return null;
  const fromText = m.explainedFrom === "text";
  return (
    <section className="card meaning" aria-labelledby="meaning-h">
      <h2 id="meaning-h">What this rule means</h2>
      <p className="muted">
        <code>{m.id}</code> {preview ? "Preview of your unsaved text." : m.state === "candidate" ? "Candidate: not deciding yet." : "Active."}
      </p>
      {fromText && <p className="meaning__banner" role="note"><strong>Explained from its text.</strong> This rule's shape is not one the page can put into words, so it shows the author's reason and the Cedar source and invents nothing.</p>}
      <p className="meaning__does">{m.does}</p>
      <dl className="result__facts">
        {!fromText && <Row label="Kind"><KindBadge meaning={m} /></Row>}
        {!fromText && <Row label="Who it covers">{m.who.text}</Row>}
        {!fromText && <Row label="Which tools">{m.what.text}</Row>}
        {!fromText && <Row label="Attended or unattended">{m.attended.applies === "any" ? "Any call" : m.attended.text}</Row>}
        {!fromText && <Row label="Conditions">{m.conditions.length ? <ul className="meaning__conds">{m.conditions.map((c, i) => <li key={i}>{c.kind === "unless" ? "Unless " : "When "}{c.text}</li>)}</ul> : "None"}</Row>}
        {m.approval && <Row label="Approval">{m.approval.approvers.map((a) => a.name).join(", ")} can approve.{m.approval.clearsOnApproval ? " Once someone has approved, the rule stops applying." : " An approval does not clear it."}</Row>}
        <Row label="How it combines">{m.combines}</Row>
        {m.reason && <Row label="The author's reason">{m.reason}</Row>}
      </dl>
      {fromText && m.unexplained?.length > 0 && <p className="muted">Not put into words: {m.unexplained.map((u, i) => <code key={i}>{u}</code>)}</p>}
      {examples.length > 0 ? (
        <ul className="meaning__examples" aria-label="Examples">
          {examples.map((x, i) => (
            <li key={i}>
              Example: {x.label} <Badge kind={x.outcome}>{outcomeWord(x.outcome)}</Badge>
              {x.relation === "overridden" ? " (another rule decided it; this one was beaten)." : "."} <span className="muted">Computed just now by the real rules.</span>
            </li>
          ))}
        </ul>
      ) : <p className="muted">No sample request is decided by this rule. Try it in Test a request.</p>}
      <details className="meaning__source"><summary>Cedar source</summary><pre className="result__body">{m.source}</pre></details>
    </section>
  );
}

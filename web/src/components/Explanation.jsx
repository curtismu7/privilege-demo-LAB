// The plain-English "why" of one decision, as the server built it from the real evaluation (see server/src/explain/). It only
// renders what it is given; every sentence arrives ready-made. Each status is a word, never a colour alone.
import { useSession } from "../session";

const GROUPS = [
  ["decided", "Decided this", (r) => r.deciding],
  ["applied", "Also applied", (r) => !r.deciding && ["allowed", "overridden", "blocked", "held", "hold-moot"].includes(r.status)],
  ["not-applied", "Did not apply", (r) => !r.deciding && r.status === "not-applied"],
];

function Rule({ r }) {
  return (
    <li className="explain__rule">
      <span className="rule-chip" data-state={r.status}>{r.statusText}</span>
      <code>{r.id}</code>
      {r.reason && <span className="explain__reason">{r.reason}</span>}
      {r.explainedFrom === "text" && <span className="muted"> (explained from its text)</span>}
      <span className="explain__oneline muted">{r.oneLine}</span>
      {r.because.length > 0 && <ul className="explain__because">{r.because.map((b, i) => <li key={i}>{b}</li>)}</ul>}
    </li>
  );
}

function Technical({ t }) {
  return (
    <details className="explain__tech">
      <summary>Technical details</summary>
      <dl className="result__facts">
        <dt>Deciding policy</dt><dd><code>{t.rule}</code></dd>
        <dt>Reason</dt><dd>{t.reason}</dd>
        <dt>All forbids that fired</dt><dd>{t.rules.length ? t.rules.map((r) => <code key={r}>{r}</code>) : "none"}</dd>
        <dt>Overridden policies</dt><dd>{t.overridden.length ? t.overridden.map((r) => <code key={r}>{r}</code>) : "none"}</dd>
        <dt>Engine</dt><dd>Cedar {t.engine}</dd>
      </dl>
    </details>
  );
}

/** explanation: the server's `explanation` object. showTechnical=false when the caller already shows the raw facts. */
export default function Explanation({ explanation: e, showTechnical = true }) {
  const { me } = useSession();
  if (!e) return null;
  if (e.error) return <p className="muted explain__error">{e.text}</p>;
  // The server words the hold for any reader ("sign in as Priya"); when the reader already is that approver, say so instead.
  const viewerAsApprover = e.approval?.approvers.find((a) => me?.sub && a.sub === me.sub);
  const approvalText = viewerAsApprover ? e.approval.text.replace(/\(sign in as [^)]*\)/, `(you are signed in as ${viewerAsApprover.name})`) : e.approval?.text;
  const other = e.rules.filter((r) => r.status === "not-about-tool");
  return (
    <div className="explain" data-state={e.outcome}>
      <p className="explain__headline">{e.headline}</p>
      <section className="explain__section">
        <h4>Who asked</h4>
        <p>{e.who.text}</p>
      </section>
      <section className="explain__section">
        <h4>What was asked</h4>
        <p>{e.asked.text}</p>
      </section>
      <section className="explain__section">
        <h4>Why</h4>
        <p>{e.why}</p>
      </section>
      {e.change && (
        <section className="explain__section">
          <h4>What would change the answer</h4>
          <p>{e.change.text}</p>
        </section>
      )}
      {e.approval && (
        <section className="explain__section">
          <h4>Approval</h4>
          <p>{approvalText} <a href={e.approval.where}>Open Approvals</a></p>
        </section>
      )}
      {e.rules.length > 0 && (
        <section className="explain__section">
          <h4>Rules checked ({e.rules.length})</h4>
          {GROUPS.map(([key, title, test]) => {
            const items = e.rules.filter(test);
            return items.length ? (
              <div key={key} className="rules-group">
                <h5>{title}</h5>
                <ul className="explain__rules">{items.map((r) => <Rule key={r.id} r={r} />)}</ul>
              </div>
            ) : null;
          })}
          {other.length > 0 && (
            <details className="rules-group">
              <summary>{other.length} {other.length === 1 ? "rule is" : "rules are"} about other tools</summary>
              <ul className="explain__rules">{other.map((r) => <Rule key={r.id} r={r} />)}</ul>
            </details>
          )}
        </section>
      )}
      {e.notes.length > 0 && <ul className="explain__notes muted">{e.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      {showTechnical && <Technical t={e.technical} />}
    </div>
  );
}

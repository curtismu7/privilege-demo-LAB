import Badge from "./Badge";

/**
 * "Try this": one button per scenario the shipped rules are built around. A button only FILLS IN the form (tool, arguments, the
 * agent box); it never makes the call. Beside it, in words, what to expect. The expectations are written for the mock people, so
 * the card is not shown in live mode, and a scenario written for another person is disabled and says so (the call runs as the signed-in person, so it would not give the printed result).
 */
export default function TryThis({ scenarios, me, mode, tools, onFill }) {
  const list = scenarios.filter((s) => !s.exampleOnly);
  if (mode !== "mock" || list.length === 0) return null;
  return (
    <section className="card try" aria-labelledby="try-h">
      <h2 id="try-h">Try this</h2>
      <p className="muted">Each button fills in the form below. It does not make the call.</p>
      <ul className="try__list">
        {list.map((s) => {
          const missing = tools.length > 0 && !tools.some((t) => t.name === s.tool);
          const other = s.as !== me?.persona; // the call runs as the signed-in person, so a result written for someone else may differ
          return (
            <li key={s.id} className={`try__item${other ? " try__item--other" : ""}`}>
              <button type="button" onClick={() => onFill(s)} disabled={missing || other}>{s.label}</button>
              <span className="try__expect">{other ? `Expect, as ${s.asName}:` : "Expect:"} <Badge kind={s.expect.outcome} /> {s.note}</span>
              {other && <span className="try__hint muted">Written for {s.asName}. Sign in as {s.asName} to get this result.</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

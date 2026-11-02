import { GLOSSARY } from "../glossary";

/** What the words on this page mean. A closed <details> so it is there when needed and quiet otherwise. */
export default function Glossary() {
  return (
    <details className="glossary card">
      <summary>What do these words mean?</summary>
      <dl className="glossary__list">
        {GLOSSARY.map((g) => (
          <div key={g.term} className="glossary__row">
            <dt>{g.term}{g.cedar && <span className="muted glossary__cedar"> (Cedar word: {g.cedar})</span>}</dt>
            <dd>{g.def}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

import { useState } from "react";

// A three-step strip at the top of the Tool console. Hide it and it folds into one button; the choice is remembered in
// localStorage when that works, and for this page view only when it does not (blocked or throwing storage).
export const HOWTO_KEY = "privdemo.console.howto";
const readHidden = () => { try { return localStorage.getItem(HOWTO_KEY) === "hidden"; } catch { return false; } };
const remember = (hidden) => { try { if (hidden) localStorage.setItem(HOWTO_KEY, "hidden"); else localStorage.removeItem(HOWTO_KEY); } catch { /* not remembered */ } };

export default function HowItWorks() {
  const [hidden, setHidden] = useState(readHidden);
  const set = (v) => { setHidden(v); remember(v); };
  if (hidden) {
    return (
      <p className="howto howto--closed">
        <button type="button" aria-expanded="false" onClick={() => set(false)}>How this works</button>
      </p>
    );
  }
  return (
    <section className="howto card" aria-labelledby="howto-h" id="howto-body">
      <div className="howto__head">
        <h2 id="howto-h">How this works</h2>
        <button type="button" aria-expanded="true" aria-controls="howto-body" onClick={() => set(true)}>Hide</button>
      </div>
      <ol className="howto__steps">
        <li><strong>Ask.</strong> A person, or their agent, asks to use a tool.</li>
        <li><strong>Decide.</strong> The rules decide. Every rule is checked. A block rule beats an allow rule, and if no rule allows it, it is denied.</li>
        <li><strong>Result.</strong> The result is Allow (the tool runs), Deny (it does not) or Hold (a person has to approve first).</li>
      </ol>
    </section>
  );
}

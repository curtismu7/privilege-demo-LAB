import { useEffect, useState } from "react";
import { api } from "../api";

/** Setup problems the server found (GET /api/preflight), each with its fix. Renders nothing when all is well. */
export default function PreflightCard() {
  const [bad, setBad] = useState([]);
  useEffect(() => {
    let live = true;
    api("/api/preflight").then((r) => { if (live && r.ok) setBad(r.data.checks.filter((c) => !c.ok && c.level === "error")); });
    return () => { live = false; };
  }, []);
  if (!bad.length) return null;
  return (
    <section className="card" aria-labelledby="pre-h">
      <h2 id="pre-h">Setup needed</h2>
      <ul className="problems" aria-label="Setup problems">
        {bad.map((c) => <li key={c.id}><strong>{c.message}: no.</strong> {c.fix}</li>)}
      </ul>
    </section>
  );
}

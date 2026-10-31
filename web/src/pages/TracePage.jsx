import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import Badge from "../components/Badge";
import RequireSignIn from "../components/RequireSignIn";
import { PageStories } from "../story/StoryPanel";

const short = (id) => id.slice(0, 8);

function Trace() {
  const [events, setEvents] = useState(null);
  const [only, setOnly] = useState("");
  const load = useCallback(async () => { const r = await api("/api/trace"); if (r.ok) setEvents(r.data.events); }, []);
  useEffect(() => { load(); }, [load]);

  const traces = [...new Set((events ?? []).map((e) => e.trace_id))];
  const shown = (events ?? []).filter((e) => !only || e.trace_id === only);

  return (
    <main className="page">
      <h1>Trace</h1>
      <p className="lede">One row per hop, newest first: who, which product, the decision and the rule that made it, and how long it took. Tokens never appear here.</p>
      <PageStories page="trace" />
      <div className="row">
        <button type="button" onClick={load}>Refresh</button>
        <label className="check">Request
          <select value={only} onChange={(e) => setOnly(e.target.value)}>
            <option value="">All requests</option>
            {traces.map((t) => <option key={t} value={t}>{short(t)}</option>)}
          </select>
        </label>
      </div>
      {events === null ? <p role="status">Loading…</p> : shown.length === 0 ? <p className="card">No hops yet. Make a call in the <a href="/console">Tool console</a>.</p> : (
        <ol className="timeline" aria-label="Hops, newest first">
          {shown.map((e) => (
            <li key={`${e.trace_id}-${e.span_id}`} className="timeline__item">
              <span className="timeline__meta mono">{new Date(e.ts).toLocaleTimeString()}</span>
              <span>
                <strong>{e.hop}</strong> <span className="muted">({e.product})</span> <Badge kind={e.decision.result} />{" "}
                <code>{e.decision.rule}</code> {e.decision.reason}
                <span className="timeline__meta"> · {e.subject ?? "no subject"}{e.actor ? ` via ${e.actor.sub}` : ""}{e.tool ? <> · tool <code>{e.tool}</code></> : ""} · {Math.round(e.latency_ms)} ms · request <code>{short(e.trace_id)}</code></span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

export default function TracePage() {
  return <RequireSignIn><Trace /></RequireSignIn>;
}

import { useEffect, useState } from "react";
import { api } from "../api";
import { makeClaims } from "../claims";
import { usePack } from "../pack";
import Badge from "./Badge";

const GENERIC_ARGS = (tool, dot) => ({ search_flights: { query: "SFO to JFK" }, create_ticket: { subject: "Seat change" },
  pay_invoice: { invoiceId: "INV-1001", amount: 250 }, book_fare: { flightId: "FL200", amount: dot ? 2400 : 500 } })[tool];

/** S35: one decision per group x tool cell, asked of the live policies. Refreshes when `version` changes. */
export default function MappingTable({ version = 0, onResults = null }) {
  const pack = usePack();
  const { groups: GROUPS, toolNames: TOOL_NAMES } = pack;
  const generic = pack.id === "generic";
  const [dot, setDot] = useState(pack.agent.defaultOn);
  const [cells, setCells] = useState(null);
  const [cases, setCases] = useState(null);
  const argsFor = (t) => (generic ? GENERIC_ARGS(t, dot) : pack.argDefaults[t]);

  useEffect(() => {
    let live = true;
    (async () => {
      const out = {};
      await Promise.all(GROUPS.flatMap((g) => TOOL_NAMES.map(async (t) => {
        const claims = makeClaims({ sub: `table-${g}`, groups: [g], paymentsWrite: generic && g === "finance", dot, agent: pack.agent.sub });
        const r = await api("/api/decide-test", { method: "POST", body: { claims, tool: t, args: argsFor(t) } });
        out[`${g}|${t}`] = r.ok ? { outcome: r.data.outcome, rule: r.data.rule, overridden: r.data.overridden } : { outcome: "error", rule: String(r.status) };
      })));
      if (live) {
        setCells(out);
        onResults?.("grid", Object.entries(out).map(([k, c]) => { const [g, t] = k.split("|"); return { label: `People in the ${g} group calling ${t}`, ...c }; }));
      }
    })();
    return () => { live = false; };
  }, [version, dot]);

  // A pack's scenarios: the cases a group x tool grid cannot show (repo, classification, approvals). Each is asked of the live policies too.
  useEffect(() => {
    if (!pack.scenarios.length) return undefined;
    let live = true;
    (async () => {
      const out = {};
      await Promise.all(pack.scenarios.map(async (s) => {
        const claims = makeClaims({ sub: s.sub, groups: s.groups, dot: s.agent === true, agent: pack.agent.sub });
        const r = await api("/api/decide-test", { method: "POST", body: { claims, tool: s.tool, args: s.args, approvalCount: s.approvalCount ?? 0 } });
        out[s.id] = r.ok ? { outcome: r.data.outcome, rule: r.data.rule, overridden: r.data.overridden } : { outcome: "error", rule: String(r.status) };
      }));
      if (live) {
        setCases(out);
        onResults?.("cases", pack.scenarios.map((s) => ({ label: s.label, ...out[s.id] })));
      }
    })();
    return () => { live = false; };
  }, [version, pack]);

  return (
    <>
      <section className="card" aria-labelledby="map-h">
        <h2 id="map-h">Who can call what</h2>
        {generic ? (
          <>
            <p className="muted">Each cell asks the live policies. Finance is asked with the payments:write scope. Other groups have no extra scope.</p>
            <label className="check"><input type="checkbox" checked={dot} onChange={(e) => setDot(e.target.checked)} />Dot acts unattended, fare 2,400 (otherwise a direct 500 fare)</label>
          </>
        ) : (
          <>
            <p className="muted">Each cell asks the live policies, with a sample call on the grid-ops-portal repo and an internal collection. The groups are invented for this demo; every backend is a mock.</p>
            <label className="check"><input type="checkbox" checked={dot} onChange={(e) => setDot(e.target.checked)} />The delivery agent acts for the user (token carries act)</label>
          </>
        )}
        <div className="scroll-x">
          <table className="data-table">
            <caption className="sr-only">Decision for each group and tool</caption>
            <thead><tr><th scope="col">Group</th>{TOOL_NAMES.map((t) => <th key={t} scope="col"><code>{t}</code></th>)}</tr></thead>
            <tbody>
              {GROUPS.map((g) => (
                <tr key={g}>
                  <th scope="row">{g}</th>
                  {TOOL_NAMES.map((t) => {
                    const c = cells?.[`${g}|${t}`];
                    return <td key={t}>{c ? <><Badge kind={c.outcome} /><span className="data-table__rule">{c.rule}</span></> : "…"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {generic && <p className="muted">No shipped policy lets the admins group call tools; admins edit policies instead.</p>}
      </section>

      {pack.scenarios.length > 0 && (
        <section className="card" aria-labelledby="cases-h">
          <h2 id="cases-h">Cases the grid cannot show</h2>
          <p className="muted">Repo scoping, data classification, and what an approval can and cannot change. Each row asks the live policies.</p>
          <div className="scroll-x">
            <table className="data-table">
              <caption className="sr-only">Scenario decisions</caption>
              <thead><tr><th scope="col">Case</th><th scope="col">Tool</th><th scope="col">Decision</th></tr></thead>
              <tbody>
                {pack.scenarios.map((s) => {
                  const c = cases?.[s.id];
                  return (
                    <tr key={s.id}>
                      <th scope="row">{s.label}</th>
                      <td><code>{s.tool}</code></td>
                      <td>{c ? <><Badge kind={c.outcome} /><span className="data-table__rule">{c.rule}</span></> : "…"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

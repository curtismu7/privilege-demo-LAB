import { useEffect, useState } from "react";
import { api } from "../api";
import { makeClaims } from "../claims";
import { usePack } from "../pack";
import ArgFields, { defaultArgs } from "./ArgFields";
import ResultCard from "./ResultCard";

/** "Test a request": a synthetic call -> the full decision, plus what staged Candidate policies would change. Runs nothing. */
export default function TestRequest() {
  const pack = usePack();
  const { groups: GROUPS, testUsers: TEST_USERS } = pack;
  const startTool = pack.id === "generic" ? "book_fare" : pack.toolNames[0];
  const [tools, setTools] = useState([]);
  const [userId, setUserId] = useState(TEST_USERS[0].id);
  const [groups, setGroups] = useState(TEST_USERS[0].groups);
  const [paymentsWrite, setPaymentsWrite] = useState(false);
  const [dot, setDot] = useState(pack.agent.defaultOn);
  const [approvalCount, setApprovalCount] = useState(0);
  const [drift, setDrift] = useState(false);
  const [toolName, setToolName] = useState(startTool);
  const [args, setArgs] = useState(defaultArgs({ name: startTool }, pack.argDefaults));
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api("/api/tools").then((r) => r.ok && setTools(r.data.tools)); }, []);
  const tool = tools.find((t) => t.name === toolName);

  const pickUser = (id) => {
    const u = TEST_USERS.find((x) => x.id === id);
    setUserId(id); setGroups(u.groups); setPaymentsWrite(u.paymentsWrite === true);
  };
  const pickTool = (name) => { setToolName(name); setArgs(defaultArgs({ name }, pack.argDefaults)); };
  const toggleGroup = (g) => setGroups(groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g]);

  const run = async () => {
    setBusy(true);
    const body = { claims: makeClaims({ sub: userId, groups, paymentsWrite, dot, agent: pack.agent.sub }), tool: toolName, args, approvalCount, drift, explain: true };
    const r = await api("/api/decide-test", { method: "POST", body });
    setRes(r.ok ? r.data : { outcome: "error", rule: "request-failed", reason: r.data?.error ?? `HTTP ${r.status}`, overridden: [] });
    setBusy(false);
  };

  const shadow = res?.shadow;
  return (
    <section className="card" aria-labelledby="test-h">
      <h2 id="test-h">Test a request</h2>
      <p className="muted">Asks the policy engine what it would do. Nothing runs and nothing is held.</p>
      <label className="field">Who
        <select value={userId} onChange={(e) => pickUser(e.target.value)}>
          {TEST_USERS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
      </label>
      <fieldset className="field field--group">
        <legend className="field-legend">Token groups</legend>
        <div className="row">
          {GROUPS.map((g) => (
            <label key={g} className="check"><input type="checkbox" checked={groups.includes(g)} onChange={() => toggleGroup(g)} />{g}</label>
          ))}
          {pack.id === "generic" && <label className="check"><input type="checkbox" checked={paymentsWrite} onChange={(e) => setPaymentsWrite(e.target.checked)} />payments:write scope</label>}
        </div>
      </fieldset>
      <label className="field">Tool
        <select value={toolName} onChange={(e) => pickTool(e.target.value)}>
          {(tools.length ? tools.map((t) => t.name) : pack.toolNames).map((n) => <option key={n}>{n}</option>)}
        </select>
      </label>
      <ArgFields tool={tool} args={args} onChange={setArgs} />
      <label className="check"><input type="checkbox" checked={dot} onChange={(e) => setDot(e.target.checked)} />{pack.id === "generic" ? "Dot (the agent) makes the call, unattended" : pack.agent.label}</label>
      <label className="check"><input type="checkbox" checked={drift} onChange={(e) => setDrift(e.target.checked)} />The tool's schema changed since approval</label>
      <label className="field">Approvals already given
        <input type="number" min={0} max={100} value={approvalCount} onChange={(e) => setApprovalCount(Math.max(0, Number(e.target.value) || 0))} />
      </label>
      <div className="row"><button type="button" className="primary" onClick={run} disabled={busy || !tool}>Test request</button></div>
      <div aria-live="polite">
        <ResultCard title="Decision" res={res}>
          {shadow && (
            <div className="shadow" data-testid="shadow">
              <strong>Candidate shadow</strong> (staged: {shadow.candidates.map((c) => <code key={c}>{c}</code>)}). Live: <code>{shadow.active.outcome}</code> by <code>{shadow.active.rule}</code>.
              With the Candidates: <code>{shadow.candidate.outcome}</code> by <code>{shadow.candidate.rule}</code>.{" "}
              <strong>{shadow.changed ? "This would change the decision." : "No change to this decision."}</strong>
            </div>
          )}
          {res && !shadow && res.outcome !== "error" && <p className="muted shadow">No Candidate policies staged, so there is no shadow diff.</p>}
        </ResultCard>
      </div>
    </section>
  );
}

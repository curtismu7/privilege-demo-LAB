import { useEffect, useMemo, useState } from "react";
import { Background, BaseEdge, ConnectionMode, Controls, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, getSmoothStepPath, useNodesState, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { usePack } from "../pack";

// How one tool call travels: agent -> PEP -> Cedar -> MCP tool, with the approval loop and the trace. Boxes are draggable;
// Simulate walks the numbered steps at the chosen speed; Reset puts the boxes and the step back.
const BOXES = [
  { id: "agent", x: 0, y: 120, title: "AI agent (Dot)", sub: "Calls MCP tools for Mark with a Bearer token" },
  { id: "pf", x: 0, y: 430, title: "PingFederate", sub: "Issued the access token; publishes the JWKS" },
  { id: "pep", x: 400, y: 170, title: "Policy enforcement point", sub: "Checks the token, asks Cedar, enforces the answer", key: true },
  { id: "cedar", x: 800, y: -20, title: "Cedar engine", sub: "Policies decide: a forbid beats a permit", key: true },
  { id: "tool", x: 800, y: 250, title: "MCP tool server", sub: "search_flights, create_ticket, pay_invoice, book_fare" },
  { id: "approvals", x: 400, y: 430, title: "Approvals queue", sub: "Holds the call for the named approver" },
  { id: "approver", x: 800, y: 440, title: "Priya (approver)", sub: "Approves or denies" },
  { id: "trace", x: 400, y: -90, title: "Trace timeline", sub: "One event per hop, one traceparent" },
];
// fh/th: a side (t, b, l, r) and a slot 1-3 on it. side/dx/dy place the label so close edges do not overlap.
const EDGES = [
  { id: "e1", from: "agent", to: "pep", fh: "r2", th: "l1", label: "Tool call + Bearer token", dy: -16 },
  { id: "e2", from: "pep", to: "pf", fh: "l3", th: "t2", label: "Verify token against the JWKS", dashed: true, dy: -14 },
  { id: "e3", from: "pep", to: "cedar", fh: "r1", th: "l3", label: "decide(claims, tool, args)", dy: 60 },
  { id: "e4", from: "cedar", to: "pep", fh: "b2", th: "t3", label: "allow / deny / hold + deciding policy", dy: -14 },
  { id: "e5", from: "pep", to: "tool", fh: "r3", th: "l2", label: "Allow: run the tool", dy: 18 },
  { id: "e6", from: "pep", to: "approvals", fh: "b1", th: "t1", label: "Hold: queue the request", side: "left", dx: -8 },
  { id: "e7", from: "approver", to: "approvals", fh: "l2", th: "r2", label: "Approve or deny", dy: -16 },
  { id: "e8", from: "approvals", to: "pep", fh: "t3", th: "b3", label: "Re-check with one approval", dashed: true, side: "right", dx: 8 },
  { id: "e9", from: "pep", to: "trace", fh: "t2", th: "b2", label: "Hop events", dashed: true, side: "left", dx: -8 },
];
export const STEPS = [
  { t: "The agent calls a tool", text: "Dot sends a tools/call request with the user's PingFederate access token. The PEP is the only door to the tools.", nodes: ["agent", "pep"], edges: ["e1"] },
  { t: "The PEP checks the token", text: "Signature, issuer, audience and expiry are verified against the PingFederate JWKS. The groups claim is read from it. A bad token ends here with a 401.", nodes: ["pep", "pf"], edges: ["e2"] },
  { t: "Cedar decides", text: "The claims, the tool, its app, the arguments and the schema hashes go to Cedar. It answers allow or deny and names the deciding policy. A deny whose forbids all name approvers becomes a hold.", nodes: ["pep", "cedar"], edges: ["e3", "e4"] },
  { t: "Allow: the tool runs", text: "Only an allow reaches the tool server. The result goes back to the agent with the decision.", nodes: ["pep", "tool"], edges: ["e5"] },
  { t: "Hold: a person is asked", text: "A held call is queued for the policy's approvers and nothing runs. The requester cannot approve their own request.", nodes: ["pep", "approvals", "approver"], edges: ["e6", "e7"] },
  { t: "The answer re-checks the call", text: "On approve the PEP asks Cedar again with one approval and runs the tool at most once. A deny, or no answer in time, ends the call.", nodes: ["approvals", "pep", "tool"], edges: ["e8", "e5"] },
  { t: "Every hop is traced", text: "Auth, Cedar, PEP, tool and approval each emit an event on the same traceparent: who, the decision, the rule, the latency. No token is stored.", nodes: ["pep", "trace"], edges: ["e9"] },
];

const SIDES = { t: Position.Top, b: Position.Bottom, l: Position.Left, r: Position.Right };
// Three connection slots per side, so edges between the same two boxes can leave and enter apart.
const SLOTS = Object.entries(SIDES).flatMap(([side, pos]) => [1, 2, 3].map((i) => ({ id: `${side}${i}`, pos, style: { [side === "t" || side === "b" ? "left" : "top"]: `${i * 25}%`, opacity: 0 } })));
function Box({ data }) {
  return (
    <div className={`flow-node${data.key ? " key" : ""}${data.on ? " on" : ""}${data.dim ? " dim" : ""}`}>
      {SLOTS.map((h) => <Handle key={h.id} id={h.id} type="source" position={h.pos} style={h.style} />)}
      <strong>{data.title}</strong><span>{data.sub}</span>
    </div>
  );
}

// Smooth-step edge whose words sit beside the line (always shown), nudged by data.dx/dy so close edges do not overlap.
const ANCHOR = { left: "translate(-100%,-50%)", right: "translate(0,-50%)" };
function LabelEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, label, data }) {
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div className={`elabel nodrag nopan${data.on ? " on" : ""}${data.dim ? " dim" : ""}`}
          style={{ transform: `${ANCHOR[data.side] ?? "translate(-50%,-50%)"} translate(${lx + (data.dx ?? 0)}px,${ly + (data.dy ?? 0)}px)` }}>{label}</div>
      </EdgeLabelRenderer>
    </>
  );
}
const nodeTypes = { box: Box };
const edgeTypes = { label: LabelEdge };

const initialNodes = (boxes = BOXES) => boxes.map((b) => ({ id: b.id, type: "box", position: { x: b.x, y: b.y }, ariaLabel: `${b.title}. ${b.sub}`, data: { title: b.title, sub: b.sub, key: b.key } }));

function Flow() {
  const rf = useReactFlow();
  const pack = usePack();
  const boxes = useMemo(() => BOXES.map((b) => ({ ...b, ...(pack.diagram?.boxes?.[b.id] ?? {}) })), [pack]);
  const steps = useMemo(() => (pack.diagram?.agentStep ? STEPS.map((s, i) => (i === 0 ? { ...s, text: pack.diagram.agentStep } : s)) : STEPS), [pack]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes(boxes));
  const lit = step ? steps[step - 1] : null;

  useEffect(() => {
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, on: !!lit && lit.nodes.includes(n.id), dim: !!lit && !lit.nodes.includes(n.id) } })));
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return undefined;
    const t = setTimeout(() => (step >= steps.length ? setPlaying(false) : setStep(step + 1)), 2600 / speed);
    return () => clearTimeout(t);
  }, [playing, step, speed]);

  const edges = useMemo(() => EDGES.map((e) => {
    const on = !!lit && lit.edges.includes(e.id);
    const n = steps.findIndex((s) => s.edges.includes(e.id)) + 1;
    return {
      id: e.id, source: e.from, target: e.to, sourceHandle: e.fh, targetHandle: e.th, label: `${n} · ${e.label}`, type: "label",
      data: { on, dim: !!lit && !on, side: e.side, dx: e.dx, dy: e.dy },
      className: `${e.dashed ? "dashed" : ""}${lit && !on ? " dim" : ""}`, animated: on, markerEnd: { type: MarkerType.ArrowClosed },
    };
  }), [lit]);

  const simulate = () => { if (!step || step >= steps.length) setStep(1); setPlaying(true); };
  const reset = () => { setPlaying(false); setStep(0); setSpeed(1); setNodes(initialNodes(boxes)); setTimeout(() => rf.fitView({ padding: 0.1 }), 0); };

  return (
    <main className="page">
      <h1>Diagram</h1>
      <p className="lede">How one tool call is checked. Drag the boxes to rearrange them, or focus a box and use the arrow keys.</p>
      <div className="flow-wrap">
        <aside aria-label="Simulation">
          <div className="row">
            <button type="button" className="btn primary" onClick={playing ? () => setPlaying(false) : simulate}>{playing ? "Pause" : "Simulate"}</button>
            <button type="button" className="btn" onClick={() => { setPlaying(false); setStep(Math.max(0, step - 1)); }} disabled={step === 0}>Back</button>
            <button type="button" className="btn" onClick={() => { setPlaying(false); setStep(Math.min(steps.length, step + 1)); }} disabled={step === steps.length}>Next</button>
            <button type="button" className="btn" onClick={reset}>Reset</button>
          </div>
          <label className="speed">Speed
            <input type="range" min="0.5" max="3" step="0.5" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-valuetext={`${speed} times`} />
            <output>{speed}×</output>
          </label>
          <ol className="steps" aria-label="Steps">
            {steps.map((s, i) => (
              <li key={s.t}><button type="button" className="btn" aria-current={step === i + 1 ? "step" : undefined} style={step === i + 1 ? { borderColor: "var(--ping-red)" } : undefined}
                onClick={() => { setPlaying(false); setStep(i + 1); }}>{i + 1} · {s.t}</button></li>
            ))}
          </ol>
          <p aria-live="polite" data-testid="step-text">
            {lit ? <><strong>Step {step} of {steps.length}: {lit.t}.</strong> {lit.text}</> : "Press Simulate, or pick a step. The deny path ends at step 3; allow and hold continue."}
          </p>
          <p className="muted">Dashed blue lines are checks and records beside the main path.</p>
        </aside>
        <div className="flow-canvas" data-testid="flow-canvas">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} nodesDraggable nodesConnectable={false}
            connectionMode={ConnectionMode.Loose} fitView fitViewOptions={{ padding: 0.1 }} minZoom={0.3} proOptions={{ hideAttribution: true }}>
            <Background gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>
    </main>
  );
}

export default function DiagramPage() {
  return <ReactFlowProvider><Flow /></ReactFlowProvider>;
}

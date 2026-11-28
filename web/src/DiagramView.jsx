import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, Handle, Position, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./DiagramView.css";
import { ArrowNoLabel, EdgeLabels, FitOpen, Passport, PassportActions } from "./diagram-kit/DiagramKit.jsx";
import { boxPassport, inOutPoint } from "./diagram-kit/diagramKit.js";
import "./diagram-kit/diagram-kit.css";
import Json from "./components/JsonPane";
import { loadDiagram, withPackWording } from "./diagrams/index.js";
import { hopsToCalls, withHops } from "./hopsToCalls.js";
import { useStepper, SPEEDS } from "./stepper.js";

// Renders diagram-studio/1 data: a named diagram (`id`). Boxes are movable; Reset puts every box back and stops the walkthrough;
// Simulate walks the steps at the chosen speed. Pattern from diagram-studio and the other labs' DiagramView.
export function usePositions(diagram) {
  const original = useMemo(() => Object.fromEntries(diagram.nodes.map((n) => [n.id, { x: n.x, y: n.y }])), [diagram]);
  const [positions, setPositions] = useState(original);
  useEffect(() => { setPositions(original); }, [original]);
  const move = useCallback((id, position) => setPositions((p) => ({ ...p, [id]: position })), []);
  const reset = useCallback(() => setPositions(original), [original]);
  return { positions, move, reset, original };
}

// Reset: every box back to the data's position, the walkthrough stopped, and the view re-fitted (zoom and pan).
export function resetDiagram({ reset, dispatch, instance }) {
  reset();
  dispatch({ type: "stop" });
  instance?.fitView?.();
}

// Arrows run left to right (out on the right, in on the left). An arrow that points back to the left uses the "back" handles, out on
// the left and in on the right. Boxes stacked in one column join top to bottom instead. Same rule as diagram-studio's canvas.
function BoxNode({ data }) {
  return (
    <div className={`dg-node dg-node--${data.color}`}>
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Left} id="back-out" className="handle-back" isConnectable={false} />
      <Handle type="target" position={Position.Top} id="top-in" />
      <Handle type="source" position={Position.Top} id="top-out" isConnectable={false} />
      <strong>{data.label}</strong>
      {data.sub.map((line, i) => <span key={`${i}-${line}`}>{line}</span>)}
      <Handle type="source" position={Position.Right} id="out" />
      <Handle type="target" position={Position.Right} id="back-in" className="handle-back" isConnectable={false} />
      {data.passport && <Passport p={data.passport} JsonView={Json} />}
    </div>
  );
}
const nodeTypes = { box: BoxNode };

// The curve only: every label is drawn by the diagram kit's EdgeLabels, in a layer above the boxes,
// placed so no two labels overlap and none sits on a box (the shared standard, UI patterns §8c).
const edgeTypes = { arrow: ArrowNoLabel };

const STACKED = 60; // boxes whose x differs by less than this are stacked in one column

export function toFlow(diagram, positions, activeEdges, simulating) {
  const nodes = diagram.nodes.map((n) => ({
    id: n.id,
    type: "box",
    position: positions[n.id] ?? { x: n.x, y: n.y },
    ariaLabel: `${n.label}. ${(n.sub ?? []).join(". ")}`,
    data: { label: n.label, sub: n.sub ?? [], color: diagram.groups[n.group]?.color ?? "grey" },
  }));
  const at = new Map(nodes.map((n) => [n.id, n.position]));
  const edges = diagram.edges.map((e, i) => {
    const on = activeEdges.has(i);
    const from = at.get(e.source);
    const to = at.get(e.target);
    const vertical = Math.abs(to.x - from.x) < STACKED;
    const back = !vertical && to.x < from.x;
    const up = to.y < from.y;
    const handles = vertical
      ? { sourceHandle: up ? "top-out" : "bottom-out", targetHandle: up ? "bottom-in" : "top-in" }
      : { sourceHandle: back ? "back-out" : "out", targetHandle: back ? "back-in" : "in" };
    return {
      id: `e${i}`,
      type: "arrow",
      source: e.source,
      target: e.target,
      ...handles,
      animated: on,
      markerEnd: { type: MarkerType.ArrowClosed },
      className: `${on ? "edge-on" : simulating ? "edge-dim" : ""}${e.dashed ? " edge-dashed" : ""}`,
      data: { vertical },
    };
  });
  return { nodes, edges };
}

// One label item per arrow, for the kit's EdgeLabels layer (above the boxes, never overlapping).
export function toLabelItems(diagram, edges, active) {
  return diagram.edges.map((e, i) => ({
    id: `e${i}`,
    text: e.label ?? "",
    source: e.source,
    target: e.target,
    sourceHandle: edges[i]?.sourceHandle,
    targetHandle: edges[i]?.targetHandle,
    active: active.has(i),
    dim: active.size > 0 && !active.has(i),
  }));
}

// Labels sit where the arrow meets the box: mid height on out/in, 70% down on the back pair (the kit's inOutPoint).
export const labelPointFor = (box, handle) => inOutPoint(box, String(handle));

export default function DiagramView({ id, wording = null, heading = "h3", traceEvents = null }) {
  const diagram = useMemo(() => {
    const base = withPackWording(loadDiagram(id), wording);
    return traceEvents?.length ? withHops(base, hopsToCalls(traceEvents, base.edges)) : base;
  }, [id, wording, traceEvents]);
  const { positions, move, reset } = usePositions(diagram);
  const [s, dispatch] = useStepper(diagram.steps?.length ?? 0);
  useEffect(() => { dispatch({ type: "total", total: diagram.steps?.length ?? 0 }); }, [diagram, dispatch]);

  const flowRef = useRef(null);
  const doReset = useCallback(() => { setOpen(null); resetDiagram({ reset, dispatch, instance: flowRef.current }); }, [reset, dispatch]);
  const step = s.step >= 0 ? diagram.steps[s.step] : null;
  const active = useMemo(() => new Set(step?.edges ?? []), [step]);
  const { nodes, edges } = useMemo(() => toFlow(diagram, positions, active, s.step >= 0), [diagram, positions, active, s.step]);
  // Click a box and it expands in place with its details (the shared diagram kit's Passport, §8c).
  const [open, setOpen] = useState(null);
  const graph = useMemo(() => ({
    nodes: diagram.nodes.map((n) => ({ id: n.id, label: n.label, sub: n.sub ?? [], group: n.group })),
    edges: diagram.edges.map((e, i) => ({ id: `e${i}`, source: e.source, target: e.target, label: e.label ?? "", hop: e.hop ?? null })),
    groups: diagram.groups,
  }), [diagram]);
  const passportFor = useMemo(() => (nid) => boxPassport(graph, nid), [graph]);
  const withPassport = useMemo(
    () => nodes.map((n) => ({ ...n, zIndex: n.id === open ? 10 : undefined, data: { ...n.data, passport: n.id === open ? passportFor(n.id) : null } })),
    [nodes, open, passportFor]
  );
  const items = useMemo(() => toLabelItems(diagram, edges, active), [diagram, edges, active]);
  const onNodesChange = useCallback((changes) => {
    for (const change of changes) if (change.type === "position" && change.position) move(change.id, change.position);
  }, [move]);
  const H = heading;

  return (
    <section className="diagram" aria-label={diagram.title} data-diagram={diagram.id}>
      <H className="diagram__title">{diagram.title}</H>
      {diagram.lede && <p className="lede">{diagram.lede}</p>}
      <div className="diagram__toolbar" role="group" aria-label={`${diagram.title}: diagram controls`}>
        <button type="button" className="primary" onClick={() => dispatch({ type: "simulate" })}>Simulate</button>
        <button type="button" onClick={() => dispatch({ type: "prev" })}>Back</button>
        <button type="button" onClick={() => dispatch({ type: "next" })}>Next</button>
        {/* Pause only means something while a walkthrough is playing. */}
        {s.paused
          ? <button type="button" onClick={() => dispatch({ type: "resume" })}>Resume</button>
          : <button type="button" onClick={() => dispatch({ type: "pause" })} disabled={s.step < 0}>Pause</button>}
        <button type="button" onClick={doReset}>Reset diagram</button>
        <label className="inline-field">Speed
          <select value={s.speed} onChange={(e) => dispatch({ type: "speed", speed: e.target.value })}>
            {SPEEDS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
      </div>
      <div className="diagram__canvas" data-testid="diagram-canvas">
        <PassportActions.Provider value={{ open: setOpen, close: () => setOpen(null), link: (nid) => { const u = new URL(window.location.href); u.searchParams.set("box", nid); return u.toString(); } }}>
          <ReactFlow
            nodes={withPassport}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_, n) => setOpen((o) => (o === n.id ? null : n.id))}
            onPaneClick={() => setOpen(null)}
            nodesDraggable
            nodesConnectable={false}
            onInit={(instance) => { flowRef.current = instance; }}
            fitView
            proOptions={{ hideAttribution: true }}
            minZoom={0.2}
          >
            <Background />
            <Controls showInteractive={false} />
            <EdgeLabels items={items} pointFor={labelPointFor} fallback={{ w: 240, h: 110 }} />
            <FitOpen open={open} closePadding={0.08} />
          </ReactFlow>
        </PassportActions.Provider>
      </div>
      <p className="diagram__now" role="status" data-testid="step-text">
        {step ? <><strong>Step {s.step + 1} of {diagram.steps.length}: {step.title}.</strong> {step.what}</> : "Press Simulate, or Next to step through. Drag the boxes to rearrange them."}
      </p>
    </section>
  );
}

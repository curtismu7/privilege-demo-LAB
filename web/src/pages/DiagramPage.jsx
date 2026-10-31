import { useState } from "react";
import DiagramView from "../DiagramView";
import { DIAGRAM_IDS, loadDiagram } from "../diagrams";
import { usePack } from "../pack";

// How a tool call travels, how a hold is approved, and what a rug pull looks like. Each diagram is diagram-studio/1 data, loaded by name.
export default function DiagramPage() {
  const [id, setId] = useState(DIAGRAM_IDS[0]);
  const pack = usePack();
  return (
    <main className="page">
      <h1>Diagram</h1>
      <p className="lede">Drag the boxes to rearrange them, or focus a box and use the arrow keys. Simulate walks the steps; Reset puts everything back.</p>
      <div className="story__paths" role="group" aria-label="Diagram">
        {DIAGRAM_IDS.map((d) => <button key={d} type="button" aria-pressed={d === id} onClick={() => setId(d)}>{loadDiagram(d).title}</button>)}
      </div>
      <DiagramView key={id} id={id} wording={id === DIAGRAM_IDS[0] ? pack.diagram : null} heading="h2" />
    </main>
  );
}

import toolCall from './pd-tool-call.json';
import approval from './pd-approval.json';
import rugPull from './pd-rug-pull.json';

// Diagrams are diagram-studio/1 data, loaded by name. No nodes or edges are built in JSX (rule 17).
const ALL = [toolCall, approval, rugPull];
const BY_ID = new Map(ALL.map((diagram) => [diagram.id, diagram]));

export function loadDiagram(id) {
  const diagram = BY_ID.get(id);
  if (!diagram) throw new Error(`Unknown diagram: ${id}`);
  return diagram;
}
export const DIAGRAM_IDS = ALL.map((diagram) => diagram.id);

/**
 * A vertical pack may rename boxes and reword the first step (pack.diagram: { boxes: { <node id>: { title, sub } }, agentStep }).
 * Returns a new diagram; the data is not changed. Only boxes that exist are renamed.
 */
export function withPackWording(diagram, wording) {
  if (!wording) return diagram;
  const nodes = diagram.nodes.map((n) => {
    const w = wording.boxes?.[n.id];
    return w ? { ...n, label: w.title ?? n.label, sub: w.sub ? [w.sub] : n.sub } : n;
  });
  const steps = wording.agentStep && diagram.steps?.length ? diagram.steps.map((s, i) => (i === 0 ? { ...s, what: wording.agentStep } : s)) : diagram.steps;
  return { ...diagram, nodes, steps };
}

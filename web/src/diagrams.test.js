import { describe, expect, it } from "vitest";
import { DIAGRAM_IDS, loadDiagram, withPackWording } from "./diagrams/index.js";
import { validateDiagram } from "./diagrams/validate.js";
import { labelShifts, toFlow } from "./DiagramView.jsx";

const NODE_W = 240; // .dg-node max-width
const NODE_H = 110; // a box with a title and up to three lines

describe("named diagrams (diagram-studio/1 data, rule 17)", () => {
  it("every diagram passes the studio validator", () => {
    for (const id of DIAGRAM_IDS) expect([id, validateDiagram(loadDiagram(id))]).toEqual([id, []]);
  });
  it("an unknown name is refused", () => {
    expect(() => loadDiagram("nope")).toThrow(/Unknown diagram/);
  });
  it("every step names edges that exist, and every edge is used by some step (nothing drawn that is never explained)", () => {
    for (const id of DIAGRAM_IDS) {
      const d = loadDiagram(id);
      const used = new Set(d.steps.flatMap((s) => s.edges));
      d.edges.forEach((_e, i) => expect(used.has(i), `${id}: edge ${i} is in no step`).toBe(true));
    }
  });
  it("no two boxes start on top of each other, and no purple colour is used", () => {
    for (const id of DIAGRAM_IDS) {
      const d = loadDiagram(id);
      for (let a = 0; a < d.nodes.length; a++) {
        for (let b = a + 1; b < d.nodes.length; b++) {
          const A = d.nodes[a]; const B = d.nodes[b];
          const overlap = A.x < B.x + NODE_W && B.x < A.x + NODE_W && A.y < B.y + NODE_H && B.y < A.y + NODE_H;
          expect(overlap, `${id}: ${A.id} overlaps ${B.id}`).toBe(false);
        }
      }
      for (const g of Object.values(d.groups)) expect(["red", "dark", "grey", "blue", "green", "amber"]).toContain(g.color);
    }
  });
  it("labels are short and no edge is labelled twice with the same words between the same boxes", () => {
    for (const id of DIAGRAM_IDS) {
      const seen = new Set();
      for (const e of loadDiagram(id).edges) {
        expect(e.label.length, `${id}: ${e.label}`).toBeLessThanOrEqual(26);
        const key = `${e.source}>${e.target}:${e.label.toLowerCase()}`;
        expect(seen.has(key), `${id}: duplicate ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });
  it("a pack can reword boxes and the first step without changing the data", () => {
    const d = loadDiagram("pd-tool-call");
    const w = withPackWording(d, { boxes: { agent: { title: "Renamed agent", sub: "line" } }, agentStep: "New first step" });
    expect(w.nodes.find((n) => n.id === "agent")).toMatchObject({ label: "Renamed agent", sub: ["line"] });
    expect(w.steps[0].what).toBe("New first step");
    expect(d.nodes.find((n) => n.id === "agent").label).toBe("AI agent (Dot)");
    expect(withPackWording(d, null)).toBe(d);
  });
});

describe("arrows between the same boxes", () => {
  it("spread their labels apart, and an arrow pointing back to the left uses the back handles", () => {
    expect(labelShifts([{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "b", target: "a" }])).toEqual([-12, 0, 12]);
    const d = { groups: {}, nodes: [{ id: "a", label: "A", x: 0, y: 0 }, { id: "b", label: "B", x: 300, y: 0 }], edges: [{ source: "a", target: "b" }, { source: "b", target: "a" }] };
    const [fwd, back] = toFlow(d, { a: { x: 0, y: 0 }, b: { x: 300, y: 0 } }, new Set(), false).edges;
    expect([fwd.sourceHandle, fwd.targetHandle, fwd.data.labelShift]).toEqual(["out", "in", -12]);
    expect([back.sourceHandle, back.targetHandle, back.data.labelShift]).toEqual(["back-out", "back-in", 12]);
    const [moved] = toFlow(d, { a: { x: 600, y: 0 }, b: { x: 300, y: 0 } }, new Set(), false).edges;
    expect(moved.sourceHandle).toBe("back-out");
  });
  it("boxes stacked in one column join top to bottom", () => {
    const d = { groups: {}, nodes: [{ id: "a", label: "A", x: 0, y: 0 }, { id: "b", label: "B", x: 10, y: 300 }], edges: [{ source: "a", target: "b" }, { source: "b", target: "a" }] };
    const [down, up] = toFlow(d, { a: { x: 0, y: 0 }, b: { x: 10, y: 300 } }, new Set(), false).edges;
    expect([down.sourceHandle, down.targetHandle, down.data.vertical]).toEqual(["bottom-out", "top-in", true]);
    expect([up.sourceHandle, up.targetHandle]).toEqual(["top-out", "bottom-in"]);
  });
});

import { describe, expect, it } from "vitest";
import { examplesFor, outcomeWord } from "./policyExamples";

const pool = [
  { label: "A", outcome: "allow", rule: "r1", overridden: [] },
  { label: "B", outcome: "allow", rule: "r1", overridden: [] },
  { label: "C", outcome: "deny", rule: "r1", overridden: [] },
  { label: "D", outcome: "deny", rule: "r2", overridden: ["r3"] },
];

describe("examplesFor", () => {
  it("returns up to two examples decided by the rule, one per outcome, in pool order", () => {
    expect(examplesFor("r1", pool).map((x) => x.label)).toEqual(["A", "C"]);
    expect(examplesFor("r1", pool, 1).map((x) => x.label)).toEqual(["A"]);
    expect(examplesFor("r1", pool).every((x) => x.relation === "decides")).toBe(true);
  });
  it("falls back to one request the rule was beaten on", () => {
    expect(examplesFor("r3", pool)).toEqual([{ ...pool[3], relation: "overridden" }]);
  });
  it("is empty when no request involves the rule", () => {
    expect(examplesFor("nope", pool)).toEqual([]);
    expect(examplesFor("r1", [])).toEqual([]);
  });
  it("words the outcomes", () => { expect(["allow", "deny", "hold"].map(outcomeWord)).toEqual(["Allow", "Deny", "Hold"]); });
});

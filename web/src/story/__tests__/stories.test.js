// Pattern from id-jag-standalone web/src/story/__tests__/stories.test.js, on this app's stories and pages.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fill, fillAll, tokensIn } from "../fill";
import { DEFAULT_VERTICAL, PAGES_WITH_STORIES, STORIES, VERTICALS, storiesForPage, storyById, verticalById } from "../stories";
import { validateStory, validateVertical } from "../storySchema";

const good = () => JSON.parse(JSON.stringify(STORIES[0]));
const opts = { modes: PAGES_WITH_STORIES, stepRange: [1, 8] };

const POLICY_DIR = path.resolve(process.cwd(), "../server/src/cedar/policies"); // vitest runs with web/ as cwd
const SHIPPED = fs.readdirSync(POLICY_DIR).filter((f) => f.endsWith(".cedar")).map((f) => f.slice(0, -6));

describe("story data against the shipped policies", () => {
  it("every policy id a story names is a shipped policy (so renaming a policy breaks this test)", () => {
    const named = new Set();
    for (const s of STORIES) for (const m of JSON.stringify(s).match(/\bs\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []) named.add(m);
    expect(named.size).toBeGreaterThan(0);
    for (const id of named) expect(SHIPPED, `a story names ${id}`).toContain(id);
  });
});

describe("shipped data", () => {
  it("has the five stories and the generic, airlines and banking packs", () => {
    expect(STORIES.map((s) => s.id)).toEqual(["S01", "S04", "S05", "S23", "S35"]);
    expect(VERTICALS.map((v) => v.id).sort()).toEqual(["airlines", "banking", "generic"]);
    expect(VERTICALS.map((v) => v.id)).toContain(DEFAULT_VERTICAL);
  });

  it.each(STORIES.map((s) => [s.id, s]))("story %s is valid", (_id, s) => expect(validateStory(s, opts)).toEqual([]));
  it.each(VERTICALS.map((v) => [v.id, v]))("vertical %s is valid", (_id, v) => expect(validateVertical(v)).toEqual([]));

  it("every token in every story resolves in every pack (no missing marker can reach the page)", () => {
    for (const s of STORIES) {
      for (const v of VERTICALS) {
        expect(JSON.stringify(fillAll(s, v)), `${s.id} in ${v.id}`).not.toContain("⟨missing");
        for (const t of tokensIn(s)) {
          const ok = t.startsWith("vocab.") ? v.vocab[t.slice(6)] : v.cast[t]?.name;
          expect(ok, `${s.id} uses {{${t}}} which ${v.id} lacks`).toBeTruthy();
        }
      }
    }
  });

  it("every pack defines the same vocabulary and cast", () => {
    const keys = (v) => [Object.keys(v.vocab).sort(), Object.keys(v.cast).sort()];
    for (const v of VERTICALS) expect(keys(v)).toEqual(keys(VERTICALS[0]));
  });

  it("every page that should show a story has one, and every story is on a page", () => {
    expect(storiesForPage("console").map((s) => s.id)).toEqual(["S01", "S04", "S05"]);
    expect(storiesForPage("approvals").map((s) => s.id)).toEqual(["S01"]);
    expect(storiesForPage("policies").map((s) => s.id)).toEqual(["S23", "S35"]);
    for (const s of STORIES) expect(s.modes.length).toBeGreaterThan(0);
  });

  it("no pack mentions environment ids, hostnames or secrets", () => {
    for (const v of VERTICALS) {
      const j = JSON.stringify(v);
      expect(j).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(j).not.toMatch(/secret|password|token_|https?:\/\//i);
    }
  });

  it("no purple in a pack's brand colours", () => {
    for (const v of VERTICALS) for (const c of Object.values(v.brand)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      expect(b > r + 40 && b > g + 40 && r > g + 20, `${v.id} ${c}`).toBe(false);
    }
  });
});

describe("validateStory", () => {
  it("names each problem", () => {
    const s = good();
    s.id = "11"; s.steps[0].n = 99; s.steps[1].n = s.steps[2].n; delete s.steps[0].say; delete s.proof.blocked; s.modes = ["nope"];
    const errors = validateStory(s, opts).join("\n");
    expect(errors).toContain("id must look like S11");
    expect(errors).toContain("duplicates another step");
    expect(errors).toContain("steps[n=99].say is required text");
    expect(errors).toContain("proof needs happy and blocked text");
    expect(errors).toContain('unknown page "nope"');
  });
  it("rejects a blocked variant without both tell and say", () => {
    const s = STORIES.map((x) => JSON.parse(JSON.stringify(x))).find((x) => x.steps.some((st) => st.blocked));
    s.steps.find((x) => x.blocked).blocked = { tell: "only half" };
    expect(validateStory(s, opts).join()).toContain("blocked needs tell and say");
  });
  it("requires ascending step order", () => {
    const s = good();
    s.steps.reverse();
    expect(validateStory(s, opts).join()).toContain("ascending order");
  });
});

describe("validateVertical", () => {
  it("rejects a bad colour and a vocab that is not text", () => {
    const v = { ...verticalById("banking"), brand: { primary: "red", headerStart: "#000000", headerEnd: "#000000" }, vocab: { a: 3 } };
    const errors = validateVertical(v).join("\n");
    expect(errors).toContain("brand.primary must be a #rrggbb color");
    expect(errors).toContain("vocab must map names to text");
  });
});

describe("fill and lookup", () => {
  const v = { cast: { lena: { name: "Lena" } }, vocab: { partner: "a partner bank" } };
  it("replaces cast and vocab tokens and keeps an undefined one visible", () => {
    expect(fill("{{lena}} works at {{ vocab.partner }}.", v)).toBe("Lena works at a partner bank.");
    expect(fill("{{nobody}}", v)).toBe("⟨missing: nobody⟩");
  });
  it("fillAll copies and does not change the source", () => {
    const src = { t: "{{lena}}", arr: ["{{lena}}"] };
    expect(fillAll(src, v)).toEqual({ t: "Lena", arr: ["Lena"] });
    expect(src.t).toBe("{{lena}}");
  });
  it("finds stories and falls back to generic for an unknown vertical", () => {
    expect(storyById("S05").title).toMatch(/changed overnight/);
    expect(storyById("S99")).toBeNull();
    expect(verticalById("nope").id).toBe(DEFAULT_VERTICAL);
  });
});

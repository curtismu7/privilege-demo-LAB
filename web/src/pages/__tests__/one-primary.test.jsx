// UI patterns P9: exactly one primary button per view state (the static checker is scripts/check-ui-patterns.mjs in
// AI-DEMO-Standalone; it reads source, so these tests pin what each page really renders and a red button cannot drift back).
import { readFileSync } from "node:fs";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ApprovalsPage from "../ApprovalsPage";
import LearnPage from "../LearnPage";
import PoliciesPage from "../PoliciesPage";
import TracePage from "../TracePage";
import { PEOPLE, TOOLS, mockApi, renderAs } from "../../testUtils";
import { reloadStoryPrefs } from "../../story/useStoryPrefs";

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } act(() => reloadStoryPrefs()); });
afterEach(() => { vi.unstubAllGlobals(); });

/** The label of every primary button (class "primary") inside the rendered page. */
const primaries = (container) => [...container.querySelectorAll("button.primary")].map((b) => b.textContent.trim());

const POLICIES = [
  { id: "s01-hold-large-fare", state: "active", text: "forbid (principal, action, resource);", effect: "forbid", reason: "Fares over 1000 need a second pair of eyes", approvers: "priya" },
  { id: "s23-forbid-over-cap", state: "active", text: "forbid (principal, action, resource);", effect: "forbid", reason: "Hard cap: no booking over 10000 for anyone", approvers: null },
];
const policyRoutes = () => ({
  "GET /api/tools": { tools: TOOLS }, "GET /api/policies": { policies: POLICIES, error: null },
  "POST /api/decide-test": { outcome: "deny", decision: "deny", rule: "s23-forbid-over-cap", rules: ["s23-forbid-over-cap"], overridden: [], reason: "x", problems: [], approvers: [], shadow: null },
  "POST /api/reset": { ok: true },
});
const held = (id, over = {}) => ({ id, status: "pending", tool: "book_fare", app: "booking", args: { flightId: "FL200", amount: 2400 }, requester: { sub: "mark", actor: "dot" },
  policy: { rule: "s01-hold-large-fare", reason: "Fares over 1000 need a second pair of eyes" }, approvers: ["priya"], justification: `why ${id}`,
  createdAt: "2026-10-21T10:00:00.000Z", expiresAt: "2026-10-21T10:10:00.000Z", decidedBy: null, decidedAt: null, outcome: null, ...over });

describe("Trace: one primary, the page action", () => {
  it("Refresh is the only primary, with hops and with none", async () => {
    mockApi({ "GET /api/trace": { events: [] } });
    const empty = renderAs(<TracePage />, { me: PEOPLE.mark });
    await screen.findByText(/No hops yet/);
    expect(primaries(empty.container)).toEqual(["Refresh"]);
    empty.unmount();

    const ev = { trace_id: "a".repeat(32), span_id: "0000000000000001", parent_span_id: null, product: "privilege-demo", hop: "pep", subject: "mark", actor: null, decision: { result: "hold", rule: "s01-hold-large-fare", reason: "held" }, latency_ms: 12, ts: "2026-10-21T10:00:01.000Z" };
    mockApi({ "GET /api/trace": { events: [ev] } });
    const full = renderAs(<TracePage />, { me: PEOPLE.mark });
    await screen.findByRole("list", { name: "Hops, newest first" });
    expect(primaries(full.container)).toEqual(["Refresh"]);
  });
});

describe("Approvals: one primary, the page action; row decisions are plain", () => {
  it("nothing waiting: Refresh only", async () => {
    mockApi({ "GET /api/approvals": { approvals: [] } });
    const { container } = renderAs(<ApprovalsPage />, { me: PEOPLE.priya });
    await screen.findByText(/Nothing waiting/);
    expect(primaries(container)).toEqual(["Refresh"]);
  });

  it("a held call the person may decide: Refresh stays the only primary, Approve and Deny are plain", async () => {
    mockApi({ "GET /api/approvals": { approvals: [held("id-1")] } });
    const { container } = renderAs(<ApprovalsPage />, { me: PEOPLE.priya });
    await screen.findByText("why id-1");
    expect(primaries(container)).toEqual(["Refresh"]);
    expect(screen.getByRole("button", { name: "Approve book_fare" })).not.toHaveClass("primary");
    expect(screen.getByRole("button", { name: "Deny book_fare" })).not.toHaveClass("primary");
  });

  it("several held calls: the row buttons do not repeat a primary per row", async () => {
    mockApi({ "GET /api/approvals": { approvals: [held("id-1"), held("id-2"), held("id-3")] } });
    const { container } = renderAs(<ApprovalsPage />, { me: PEOPLE.priya });
    await screen.findByText("why id-3");
    expect(screen.getAllByRole("button", { name: "Approve book_fare" })).toHaveLength(3);
    expect(primaries(container)).toEqual(["Refresh"]);
  });

  it("the requester sees no row buttons and the same single primary", async () => {
    mockApi({ "GET /api/approvals": { approvals: [held("id-1")] } });
    const { container } = renderAs(<ApprovalsPage />, { me: PEOPLE.mark });
    await screen.findByText(/You asked for this/);
    expect(primaries(container)).toEqual(["Refresh"]);
  });
});

describe("AI Policies: one primary, Test request", () => {
  it("a person who cannot edit: Test request only", async () => {
    mockApi(policyRoutes());
    const { container } = renderAs(<PoliciesPage />, { me: PEOPLE.mary });
    await screen.findAllByText("s01-hold-large-fare");
    expect(primaries(container)).toEqual(["Test request"]);
  });

  it("an admin with nothing selected: Test request only", async () => {
    mockApi(policyRoutes());
    const { container } = renderAs(<PoliciesPage />, { me: PEOPLE.dana });
    await screen.findAllByText("s01-hold-large-fare");
    expect(screen.getByRole("button", { name: "New policy" })).toBeInTheDocument();
    expect(primaries(container)).toEqual(["Test request"]);
  });

  it("an admin with a policy open: Save as Active is plain", async () => {
    mockApi(policyRoutes());
    const { container } = renderAs(<PoliciesPage />, { me: PEOPLE.dana });
    fireEvent.click((await screen.findAllByText("s01-hold-large-fare"))[0]);
    expect(screen.getByRole("button", { name: "Save as Active" })).not.toHaveClass("primary");
    expect(screen.getByRole("button", { name: "Save as Candidate" })).not.toHaveClass("primary");
    expect(primaries(container)).toEqual(["Test request"]);
  });

  it("an admin on the Confirm reset step: Confirm reset is danger text on a plain button, never a primary", async () => {
    mockApi(policyRoutes());
    const { container } = renderAs(<PoliciesPage />, { me: PEOPLE.dana });
    fireEvent.click(await screen.findByRole("button", { name: "Reset demo" }));
    const confirm = screen.getByRole("button", { name: "Confirm reset" });
    expect(confirm).toHaveClass("danger");
    expect(confirm).not.toHaveClass("primary");
    expect(primaries(container)).toEqual(["Test request"]);
  });
});

describe("Learn: no action of its own, so no primary", () => {
  it("has no primary button, and its step buttons are the selector", () => {
    const { container } = renderAs(<LearnPage />);
    expect(screen.getByTestId("story-S01")).toBeInTheDocument();
    expect(primaries(container)).toEqual([]);
  });
});

describe("styles that carry the pattern (the test environment loads no CSS, so the rules are read from the files)", () => {
  const rules = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
  it("a destructive confirm is danger text, from the token", () => {
    expect(rules("../../app.css")).toMatch(/button\.danger \{ color: var\(--danger-text\); \}/);
  });
  it("the selected step's number badge inverts so it stays visible on the accent fill", () => {
    expect(rules("../../story/StoryPanel.css")).toMatch(/\.story__step\[aria-pressed="true"\] \.story__n \{ background: var\(--on-accent\); color: var\(--accent-deep\); \}/);
  });
});

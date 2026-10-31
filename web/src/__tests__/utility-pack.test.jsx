// The utility / NERC CIP-style pack in the page: what the server sends (the real publicPack output), and what each page does with it.
// The groups are INVENTED and every backend is a MOCK; the pages must say so.
import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppShell from "../AppShell";
import ApprovalsPage from "../pages/ApprovalsPage";
import ConsolePage from "../pages/ConsolePage";
import DiagramPage from "../pages/DiagramPage";
import HomePage from "../pages/HomePage";
import LearnPage from "../pages/LearnPage";
import PoliciesPage from "../pages/PoliciesPage";
import TracePage from "../pages/TracePage";
import StoryPanel from "../story/StoryPanel";
import ResultCard from "../components/ResultCard";
import { fillAll, tokensIn } from "../story/fill";
import { PACK_IDS, STORIES, storiesForPage, storiesOf, storyById, verticalFor, verticalsOf } from "../story/stories";
import { reloadStoryPrefs } from "../story/useStoryPrefs";
import { validateStory, validateVertical } from "../story/storySchema";
import { SessionContext } from "../session";
import { mockApi, renderAs } from "../testUtils";
import { getPack, publicPack } from "../../../server/src/packs/index.js";

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } act(() => reloadStoryPrefs()); });
afterEach(() => { vi.unstubAllGlobals(); });

const SERVER = path.resolve(process.cwd(), "../server/src");
const pack = publicPack(getPack("utility"));
const config = { idp: "local-mock", mockAvailable: true, bearer: false, pack };
const EN = { sub: "eli", groups: ["engineers"], scope: "tools:invoke", isAdmin: false, source: "session", persona: "eli", name: "Eli" };
const BEN = { sub: "ben", groups: ["business-analysts"], scope: "tools:invoke", isAdmin: false, source: "session", persona: "ben", name: "Ben" };
const PRIYA = { sub: "priya", groups: ["governance-reviewers"], scope: "tools:invoke", isAdmin: false, source: "session", persona: "priya", name: "Priya" };

// What GET /api/tools returns in this pack (names, apps and arguments from the real pack; schemas as the backend states them).
const tools = getPack("utility").tools.map((t) => ({ name: t.name, app: t.app, description: t.description, inputSchema: t.inputSchema, mock: true, pinnedHash: "a".repeat(64), observedHash: "a".repeat(64), drifted: false }));

describe("what the server sends the page", () => {
  it("carries wording, names and sample arguments, but no token claims", () => {
    expect(pack.id).toBe("utility");
    expect(pack.notice).toMatch(/INVENTED/);
    expect(pack.notice).toMatch(/MOCK/);
    expect(pack.groups).toEqual(["engineers", "governance-reviewers", "business-analysts", "compliance"]);
    expect(pack.toolNames).toHaveLength(13);
    expect(Object.keys(pack.argDefaults).sort()).toEqual([...pack.toolNames].sort());
    expect(JSON.stringify(pack)).not.toMatch(/claims|client_id/);
  });
  it("the generic pack sends only its id and label (the page keeps the original wording)", () => {
    expect(publicPack(getPack("generic"))).toEqual({ id: "generic", label: expect.any(String) });
  });
});

describe("utility pack stories", () => {
  const opts = { modes: ["policies", "console", "approvals", "trace", "learn"], stepRange: [1, 8] };
  const mine = storiesOf("utility");
  const vertical = verticalsOf("utility")[0];
  const SHIPPED = [...fs.readdirSync(path.join(SERVER, "packs/utility/policies")), ...fs.readdirSync(path.join(SERVER, "cedar/policies"))].filter((f) => f.endsWith(".cedar")).map((f) => f.slice(0, -6));
  const TOOL_NAMES = pack.toolNames;

  it("has the five stories the spec asks for, plus the pack vertical, and keeps the original five untouched", () => {
    expect(PACK_IDS).toEqual(["generic", "utility"]);
    expect(mine.map((s) => s.id)).toEqual(["S61", "S62", "S63", "S64", "S65"]);
    expect(STORIES.map((s) => s.id)).toEqual(["S01", "S04", "S05", "S23", "S35"]);
    expect(vertical.id).toBe("utility");
  });
  it.each(mine.map((s) => [s.id, s]))("story %s is valid and every token resolves", (_id, s) => {
    expect(validateStory(s, opts)).toEqual([]);
    expect(JSON.stringify(fillAll(s, vertical))).not.toContain("⟨missing");
    for (const t of tokensIn(s)) expect(t.startsWith("vocab.") ? vertical.vocab[t.slice(6)] : vertical.cast[t]?.name, `{{${t}}}`).toBeTruthy();
  });
  it("the vertical is valid, has no purple, and names no URL, id or secret", () => {
    expect(validateVertical(vertical)).toEqual([]);
    const j = JSON.stringify(vertical);
    expect(j).not.toMatch(/https?:\/\/|secret|password|[0-9a-f]{8}-[0-9a-f]{4}-/i);
    for (const c of Object.values(vertical.brand)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      expect(b > r + 40 && b > g + 40 && r > g + 20, c).toBe(false);
    }
  });
  it("every policy id and every tool name a story mentions exists (renaming either breaks this test)", () => {
    const text = JSON.stringify(mine);
    const policies = new Set(text.match(/\b[us]\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []);
    expect(policies.size).toBeGreaterThan(8);
    for (const id of policies) expect(SHIPPED, `story names ${id}`).toContain(id);
    const toolsNamed = new Set(text.match(/\b(?:github|kb|cloudwatch|backlog|confluence|policy|deploy)\.[a-z_]+/g) ?? []);
    for (const t of toolsNamed) expect(TOOL_NAMES, `story names ${t}`).toContain(t);
  });
  it("the five spec stories are on the pages where they are acted out, and each says what is invented or mocked", () => {
    expect(storiesForPage("console", "utility").map((s) => s.id)).toEqual(["S61", "S62", "S63", "S64", "S65"]);
    expect(storiesForPage("approvals", "utility").map((s) => s.id)).toEqual(["S62"]);
    expect(storiesForPage("policies", "utility").map((s) => s.id)).toEqual(["S63", "S64", "S65"]);
    expect(storiesForPage("trace", "utility").map((s) => s.id)).toEqual(["S61"]);
    for (const s of mine) expect(JSON.stringify(fillAll(s, vertical))).toMatch(/groups are invented|mock/i);
  });
  it("the original pages still list only the original stories", () => {
    expect(storiesForPage("console").map((s) => s.id)).toEqual(["S01", "S04", "S05"]);
    expect(storyById("S62").title).toMatch(/\{\{ben\}\}/); // lookup by id still finds a pack story
  });
  it("the story panel in the utility pack offers only the utility vertical and fills the names", () => {
    renderAs(<StoryPanel id="S62" />, { config });
    expect(screen.getByRole("heading", { name: "Ben's story update waits for Priya" })).toBeInTheDocument();
    const options = within(screen.getByLabelText("Vertical")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Utility (NERC CIP-style)"]);
    expect(verticalFor("utility", "banking").id).toBe("utility"); // a stored choice from another pack is ignored
    fireEvent.click(screen.getByRole("button", { name: "Blocked" }));
    fireEvent.click(screen.getByRole("button", { name: /answers/ }));
    expect(screen.getByText(/Deny\. The request shows denied by Priya/)).toBeInTheDocument();
  });
  it("Learn lists the utility stories in the utility pack and the original five otherwise", () => {
    const { unmount } = renderAs(<LearnPage />, { config });
    expect(within(screen.getByLabelText("Story")).getAllByRole("option").map((o) => o.value)).toEqual(["S61", "S62", "S63", "S64", "S65"]);
    unmount();
    renderAs(<LearnPage />);
    expect(within(screen.getByLabelText("Story")).getAllByRole("option").map((o) => o.value)).toEqual(["S01", "S04", "S05", "S23", "S35"]);
  });
});

describe("pages in the utility pack", () => {
  it("the shell says on every page that the groups are invented and the backends are mocks; the original shows no notice", () => {
    const { unmount } = renderAs(<AppShell><p>x</p></AppShell>, { me: EN, config });
    expect(screen.getByTestId("pack-notice")).toHaveTextContent(/INVENTED.*MOCK/s);
    expect(within(screen.getByTestId("shell-user")).getByText("Eli")).toBeInTheDocument(); // the name comes from /api/me
    unmount();
    renderAs(<AppShell><p>x</p></AppShell>, { me: EN });
    expect(screen.queryByTestId("pack-notice")).toBeNull();
  });

  it("sign-in lists the pack's people with their lines; the 'Pull Request Review' note is on Eli", async () => {
    mockApi({ "GET /api/auth/mock/personas": { personas: ["eli", "gwen", "ben", "cora", "priya"].map((id) => ({ id, name: id })) } });
    const { session } = renderAs(<HomePage />, { config });
    const eli = await screen.findByRole("button", { name: /^eli/i });
    expect(eli).toHaveTextContent(/'Pull Request Review' is treated as these engineering review rules \(read-only, no merge, no approve\) until it is clarified/);
    expect(screen.getByRole("button", { name: /cora/i })).toHaveTextContent(/only group that may read restricted evidence/);
    fireEvent.click(screen.getByRole("button", { name: /ben/i }));
    expect(session.signIn).toHaveBeenCalledWith("ben");
  });

  it("Console starts on the pack's first tool with the agent ticked, labels every tool a mock, and sends the agent flag", async () => {
    const calls = mockApi({ "GET /api/tools": { tools }, "POST /api/tools/call": { outcome: "allow", rule: "u10-engineers-pr-review", reason: "ok", overridden: [], result: { mock: true }, attribution: { user: "eli", agent: "delivery-agent", tool: "github.read_pr" } } });
    renderAs(<ConsolePage />, { me: EN, config });
    expect(await screen.findAllByText("Mock backend")).toHaveLength(13);
    expect(screen.getByLabelText("Tool")).toHaveValue("github.read_pr");
    expect(screen.getByLabelText("repo")).toHaveValue("grid-ops-portal"); // a list, not free text
    expect(screen.getByLabelText("pr")).toHaveValue(42);
    expect(screen.getByRole("checkbox", { name: /Delivery agent/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /Call as Eli/ }));
    await screen.findByText("On behalf of");
    expect(calls.find((c) => c.url === "/api/tools/call").body).toEqual({ tool: "github.read_pr", args: { repo: "grid-ops-portal", pr: 42 }, asAgent: true });
    expect(screen.getByText("On behalf of").nextSibling).toHaveTextContent("user eli via agent delivery-agent · tool github.read_pr");
    fireEvent.change(screen.getByLabelText("Tool"), { target: { value: "kb.search" } });
    expect(screen.getByLabelText("collection")).toHaveValue("runbooks");
    expect(within(screen.getByLabelText("collection")).getAllByRole("option").map((o) => o.value)).toEqual(["runbooks", "design-notes", "audit-evidence"]);
  });

  it("the result card shows no 'On behalf of' row in the original pack (no attribution field)", () => {
    renderAs(<ResultCard title="d" res={{ outcome: "allow", rule: "r", reason: "x", overridden: [] }} />);
    expect(screen.queryByText("On behalf of")).toBeNull();
  });

  it("Approvals' empty state points at the held call of this pack", async () => {
    mockApi({ "GET /api/approvals": { approvals: [] } });
    renderAs(<ApprovalsPage />, { me: PRIYA, config });
    expect(await screen.findByText(/backlog\.update_story with the delivery agent/)).toBeInTheDocument();
  });

  it("Trace shows user, agent and tool on a row", async () => {
    mockApi({ "GET /api/trace": { events: [{ trace_id: "a".repeat(32), span_id: "b".repeat(16), hop: "pep", product: "privilege-demo", subject: "ben", actor: { sub: "delivery-agent" }, tool: "backlog.update_story",
      decision: { result: "hold", rule: "u30-hold-story-update", reason: "Updating an existing story needs a person's approval" }, latency_ms: 1, ts: new Date().toISOString() }] } });
    renderAs(<TracePage />, { me: BEN, config });
    const row = (await screen.findByRole("list", { name: /Hops/ })).querySelector("li");
    expect(row).toHaveTextContent("ben via delivery-agent");
    expect(row).toHaveTextContent("tool backlog.update_story");
  });

  it("AI Policies asks the live policies for every group x tool cell and for every pack scenario, and shows the rule", async () => {
    const asked = [];
    mockApi({
      "GET /api/tools": { tools }, "GET /api/policies": { policies: [], error: null },
      "POST /api/decide-test": (body) => { asked.push(body); return { outcome: body.tool === "github.merge_pr" ? "deny" : "allow", rule: body.tool === "github.merge_pr" ? "u20-never-merge-or-approve-pr" : "u10-engineers-pr-review", rules: [], overridden: [], reason: "r", problems: [], approvers: [], shadow: null }; },
    });
    renderAs(<PoliciesPage />, { me: EN, config });
    const grid = await screen.findByRole("table", { name: "Decision for each group and tool" });
    await waitFor(() => expect(within(grid).queryAllByText("…")).toHaveLength(0));
    expect(within(grid).getAllByRole("row")).toHaveLength(5); // header + four invented groups
    expect(within(grid).getAllByRole("columnheader")).toHaveLength(14); // Group + thirteen tools
    const scenarios = await screen.findByRole("table", { name: "Scenario decisions" });
    await waitFor(() => expect(within(scenarios).queryAllByText("…")).toHaveLength(0));
    expect(within(scenarios).getAllByRole("row")).toHaveLength(1 + pack.scenarios.length);
    expect(asked.filter((b) => b.claims.sub.startsWith("table-"))).toHaveLength(4 * 13);
    const merge = asked.find((b) => b.tool === "github.merge_pr" && b.approvalCount === 1);
    expect(merge.claims.act).toEqual({ sub: "delivery-agent" }); // the agent acts: the token carries act
    expect(screen.getAllByText("u20-never-merge-or-approve-pr").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Who")).toHaveValue("eli");
    expect(screen.queryByText("payments:write scope")).toBeNull();
  });

  it("Diagram names the delivery agent and the mock tool server, and steps through", () => {
    renderAs(<DiagramPage />, { config });
    expect(screen.getAllByText("AI agent (delivery agent)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MCP tool server (mocks)").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("step-text")).toHaveTextContent(/delivery agent sends a tools\/call request/);
  });
});

describe("Learn when the pack arrives after the first paint", () => {
  it("falls back to the pack's first story instead of crashing on the original story id", () => {
    const { rerender } = renderAs(<LearnPage />);
    expect(screen.getByLabelText("Story")).toHaveValue("S01");
    // same component, session now carries the utility pack (the config fetch finished)
    rerender(<SessionContext.Provider value={{ status: "anon", me: null, config, refresh: () => {}, signIn: async () => ({}), signOut: async () => {} }}><LearnPage /></SessionContext.Provider>);
    expect(screen.getByLabelText("Story")).toHaveValue("S61");
  });
});

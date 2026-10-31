import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppShell from "../../AppShell";
import ApprovalsPage from "../ApprovalsPage";
import ConsolePage from "../ConsolePage";
import DiagramPage from "../DiagramPage";
import { DIAGRAM_IDS, loadDiagram } from "../../diagrams";
import HomePage from "../HomePage";
import LearnPage from "../LearnPage";
import PoliciesPage from "../PoliciesPage";
import TracePage from "../TracePage";
import { PEOPLE, TOOLS, mockApi, renderAs, reply } from "../../testUtils";
import { STORIES } from "../../story/stories";
import { reloadStoryPrefs } from "../../story/useStoryPrefs";

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } act(() => reloadStoryPrefs()); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const POLICIES = [
  { id: "s23-forbid-over-cap", state: "active", text: '@id("s23-forbid-over-cap")\nforbid (principal, action, resource);', effect: "forbid", reason: "Hard cap: no booking over 10000 for anyone", approvers: null },
  { id: "s01-hold-large-fare", state: "active", text: "forbid (principal, action, resource);", effect: "forbid", reason: "Fares over 1000 need a second pair of eyes", approvers: "priya" },
  { id: "s23-forbid-over-cap", state: "candidate", text: "forbid (principal, action, resource);", effect: "forbid", reason: "Hard cap: staged", approvers: null },
];
const decision = (over = {}) => ({ outcome: "deny", decision: "deny", rule: "s23-forbid-over-cap", rules: ["s23-forbid-over-cap"], overridden: ["s23-permit-travel-agents"], reason: "Hard cap: no booking over 10000 for anyone", problems: [], approvers: [], shadow: null, ...over });
const baseRoutes = () => ({ "GET /api/tools": { tools: TOOLS }, "GET /api/policies": { policies: POLICIES, error: null }, "POST /api/decide-test": decision() });

describe("shell", () => {
  it("shows the signed-in persona and group badges, and signs out", () => {
    const { session } = renderAs(<AppShell><p>x</p></AppShell>, { me: PEOPLE.priya });
    const user = screen.getByTestId("shell-user");
    expect(within(user).getByText("Priya")).toBeInTheDocument();
    expect(within(user).getByText("travel-agents")).toBeInTheDocument();
    fireEvent.click(within(user).getByRole("button", { name: "Sign out" }));
    expect(session.signOut).toHaveBeenCalled();
  });
  it("lists every page in the nav", () => {
    renderAs(<AppShell />);
    const nav = screen.getByRole("navigation", { name: "Site" });
    for (const n of ["Sign in", "AI Policies", "Tool console", "Approvals", "Trace", "Learn", "Diagram"]) expect(within(nav).getByRole("link", { name: n })).toBeInTheDocument();
  });
});

describe("sign-in page", () => {
  it("offers the persona picker with the guard status in mock mode, Dana hidden without the switch", async () => {
    mockApi({ "GET /api/auth/mock/personas": { personas: [{ id: "mark", name: "Mark" }, { id: "mary", name: "Mary" }, { id: "priya", name: "Priya" }] } });
    const { session } = renderAs(<HomePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Mary/ }));
    expect(session.signIn).toHaveBeenCalledWith("mary");
    expect(screen.getByRole("list", { name: "Mock sign-in guards" })).toHaveTextContent(/It is refused in Live mode/);
    expect(await screen.findByText(/Dana \(admin\) is hidden/)).toBeInTheDocument();
  });
  it("shows Bearer guidance and no picker when the server is in pf mode", () => {
    renderAs(<HomePage />, { config: { idp: "pf", mockAvailable: false, bearer: true } });
    expect(screen.getByRole("heading", { name: "Bearer token" })).toBeInTheDocument();
    expect(screen.getByText(/Authorization: Bearer/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mary/ })).toBeNull();
  });
  it("names the fix for a setup problem the server reports, and shows nothing when all is well", async () => {
    mockApi({ "GET /api/preflight": { ok: false, checks: [
      { id: "pf-url", ok: false, level: "error", message: "PF_URL is set", fix: "Set PF_URL to your PingFederate base URL in .env." },
      { id: "admin-switch", ok: false, level: "warn", message: "Dana (admin) is available", fix: "touch the switch file" },
      { id: "data-dir", ok: true, level: "error", message: "DATA_DIR is writable" }] } });
    renderAs(<HomePage />, { config: { idp: "pf", mockAvailable: false, bearer: false } });
    const list = await screen.findByRole("list", { name: "Setup problems" });
    expect(list).toHaveTextContent("Set PF_URL to your PingFederate base URL");
    expect(list).not.toHaveTextContent("switch file");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });
  it("shows no setup card when preflight is all clear", async () => {
    const calls = mockApi({ "GET /api/preflight": { ok: true, checks: [{ id: "data-dir", ok: true, level: "error", message: "DATA_DIR is writable" }] } });
    renderAs(<HomePage />, { config: { idp: "pf", mockAvailable: false, bearer: true } });
    await waitFor(() => expect(calls.some((c) => c.url === "/api/preflight")).toBe(true));
    expect(screen.queryByRole("heading", { name: "Setup needed" })).toBeNull();
  });
  it("reports a refused sign-in", async () => {
    mockApi({ "GET /api/auth/mock/personas": { personas: [{ id: "mark", name: "Mark" }] } });
    const { session } = renderAs(<HomePage />);
    session.signIn.mockResolvedValue({ ok: false, status: 403, data: { reason: "proxy_header" } });
    fireEvent.click(await screen.findByRole("button", { name: /Mark/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("proxy_header");
  });
  it("asks an anonymous visitor of a protected page to sign in", () => {
    renderAs(<ConsolePage />);
    expect(screen.getByRole("heading", { name: "Sign in first" })).toBeInTheDocument();
  });
});

describe("AI Policies page", () => {
  it("lists policies with Active and Candidate state and shows the story panels", async () => {
    mockApi(baseRoutes());
    renderAs(<PoliciesPage />, { me: PEOPLE.dana });
    expect(await screen.findAllByText("Active")).toHaveLength(2);
    expect(screen.getByText("Candidate")).toBeInTheDocument();
    expect(screen.getByText(/Fares over 1000 need a second pair of eyes · approvers: priya/)).toBeInTheDocument();
    expect(screen.getByTestId("story-S23")).toBeInTheDocument();
    expect(screen.getByTestId("story-S35")).toBeInTheDocument();
  });

  it("is read only for a non-admin", async () => {
    mockApi(baseRoutes());
    renderAs(<PoliciesPage />, { me: PEOPLE.mary });
    fireEvent.click((await screen.findAllByText("s01-hold-large-fare"))[0]);
    expect(screen.getByLabelText(/Cedar text/)).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Validate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset demo" })).toBeNull();
    expect(screen.getByText(/only an admin \(Dana\) can edit/)).toBeInTheDocument();
  });

  it("validates on the server and shows the problems, then saves a valid policy", async () => {
    const calls = mockApi({
      ...baseRoutes(),
      "POST /api/policies/validate": (b) => (b.text.includes("bad") ? { ok: false, problems: [{ policyId: b.id, message: "unexpected token" }] } : { ok: true, problems: [] }),
      "PUT /api/policies/s01-hold-large-fare": { ok: true },
    });
    renderAs(<PoliciesPage />, { me: PEOPLE.dana });
    fireEvent.click((await screen.findAllByText("s01-hold-large-fare"))[0]);
    const box = screen.getByLabelText(/Cedar text/);
    expect(box).not.toHaveAttribute("readonly");
    fireEvent.change(box, { target: { value: "bad policy" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    expect(await screen.findByRole("alert", { name: "Validation problems" })).toHaveTextContent("s01-hold-large-fare: unexpected token");
    expect(calls.find((c) => c.url === "/api/policies/validate").body).toEqual({ id: "s01-hold-large-fare", text: "bad policy" });

    fireEvent.change(box, { target: { value: "forbid (principal, action, resource);" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as Candidate" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.body.state === "candidate")).toBe(true));
    expect(await screen.findByText("Saved s01-hold-large-fare as candidate.")).toBeInTheDocument();
  });

  it("shows server problems when a save is refused", async () => {
    mockApi({ ...baseRoutes(), "PUT /api/policies/s01-hold-large-fare": reply(422, { ok: false, problems: [{ policyId: "s01-hold-large-fare", message: "attribute missing" }] }) });
    renderAs(<PoliciesPage />, { me: PEOPLE.dana });
    fireEvent.click((await screen.findAllByText("s01-hold-large-fare"))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Save as Active" }));
    expect(await screen.findByText(/attribute missing/)).toBeInTheDocument();
    expect(screen.getByText("Not saved.")).toBeInTheDocument();
  });

  it("Test a request shows the deciding policy, the reason and the overridden policies", async () => {
    const calls = mockApi(baseRoutes());
    renderAs(<PoliciesPage />, { me: PEOPLE.mark });
    fireEvent.change(await screen.findByLabelText("amount", { selector: "input" }), { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: "Test request" }));
    const card = await screen.findByRole("region", { name: "Decision" });
    expect(within(card).getByText("Deny")).toBeInTheDocument();
    expect(within(card).getByText("s23-forbid-over-cap")).toBeInTheDocument();
    expect(within(card).getByText(/Hard cap: no booking over 10000/)).toBeInTheDocument();
    expect(within(card).getByText("s23-permit-travel-agents")).toBeInTheDocument();
    const sent = calls.filter((c) => c.url === "/api/decide-test").pop().body;
    expect(sent).toMatchObject({ tool: "book_fare", args: { flightId: "FL200", amount: 12000 }, approvalCount: 0, drift: false });
    expect(sent.claims).toMatchObject({ sub: "mark", groups: ["travel-agents"], scope: "tools:invoke" });
    expect(sent.claims.act).toBeUndefined();
    expect(screen.getByText(/No Candidate policies staged/)).toBeInTheDocument();
  });

  it("sends Dot, drift and the finance claims when picked, and shows a hold with its approvers", async () => {
    const calls = mockApi({ ...baseRoutes(), "POST /api/decide-test": decision({ outcome: "hold", rule: "s01-hold-large-fare", overridden: [], reason: "Fares over 1000 need a second pair of eyes", approvers: ["priya"] }) });
    renderAs(<PoliciesPage />, { me: PEOPLE.mark });
    await screen.findByLabelText("amount", { selector: "input" });
    fireEvent.change(screen.getByLabelText("Who"), { target: { value: "finance" } });
    fireEvent.click(screen.getByLabelText(/Dot \(the agent\)/));
    fireEvent.click(screen.getByLabelText(/schema changed since approval/));
    fireEvent.click(screen.getByRole("button", { name: "Test request" }));
    const card = await screen.findByRole("region", { name: "Decision" });
    expect(within(card).getByText("Hold")).toBeInTheDocument();
    expect(within(card).getByText("priya")).toBeInTheDocument();
    const sent = calls.filter((c) => c.url === "/api/decide-test").pop().body;
    expect(sent.claims).toMatchObject({ groups: ["finance"], scope: "tools:invoke payments:write", act: { sub: "dot" } });
    expect(sent.drift).toBe(true);
  });

  it("shows the candidate shadow diff", async () => {
    mockApi({ ...baseRoutes(), "POST /api/decide-test": decision({ shadow: { candidates: ["s23-forbid-over-cap"], active: { outcome: "deny", rule: "s23-forbid-over-cap" }, candidate: { outcome: "allow", rule: "s23-permit-travel-agents" }, changed: true } }) });
    renderAs(<PoliciesPage />, { me: PEOPLE.dana });
    await screen.findByLabelText("amount", { selector: "input" });
    fireEvent.click(screen.getByRole("button", { name: "Test request" }));
    const shadow = await screen.findByTestId("shadow");
    expect(shadow).toHaveTextContent("Live: deny by s23-forbid-over-cap");
    expect(shadow).toHaveTextContent("With the Candidates: allow by s23-permit-travel-agents");
    expect(shadow).toHaveTextContent("This would change the decision.");
  });

  it("builds the group-to-tool table from decisions, one per cell", async () => {
    const calls = mockApi({ ...baseRoutes(), "POST /api/decide-test": (b) => decision(b.claims.groups[0] === "analysts" && b.tool === "search_flights" ? { outcome: "allow", rule: "s04-analysts-search-ticketing", overridden: [] } : {}) });
    renderAs(<PoliciesPage />, { me: PEOPLE.dana });
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getAllByText("Deny")).toHaveLength(15));
    expect(within(table).getByText("Allow")).toBeInTheDocument();
    expect(calls.filter((c) => c.url === "/api/decide-test" && c.body.claims.sub.startsWith("table-"))).toHaveLength(16);
    expect(within(table).getByRole("row", { name: /finance/ })).toBeInTheDocument();
  });

  it("resets the demo only after a second click", async () => {
    const calls = mockApi({ ...baseRoutes(), "POST /api/reset": { ok: true } });
    renderAs(<PoliciesPage />, { me: PEOPLE.dana });
    fireEvent.click(await screen.findByRole("button", { name: "Reset demo" }));
    expect(calls.some((c) => c.url === "/api/reset")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    expect(await screen.findByText(/Demo reset/)).toBeInTheDocument();
  });
});

describe("Tool console", () => {
  it("calls as the signed-in persona and shows the PEP decision and deciding policy", async () => {
    const calls = mockApi({ "GET /api/tools": { tools: TOOLS }, "POST /api/tools/call": reply(403, { outcome: "deny", rule: "default-deny", reason: "No policy permits this", rules: [], overridden: [], problems: [] }) });
    renderAs(<ConsolePage />, { me: PEOPLE.mary });
    await screen.findByLabelText("Tool");
    await waitFor(() => expect(screen.getByRole("option", { name: "pay_invoice" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Tool"), { target: { value: "pay_invoice" } });
    fireEvent.click(screen.getByRole("button", { name: "Call as Mary" }));
    const card = await screen.findByRole("region", { name: "PEP decision" });
    expect(within(card).getByText("Deny")).toBeInTheDocument();
    expect(within(card).getByText("default-deny")).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/api/tools/call").body).toEqual({ tool: "pay_invoice", args: { invoiceId: "INV-1001", amount: 250 } });
  });

  it("sends asAgent and the justification, and links a hold to Approvals", async () => {
    const calls = mockApi({ "GET /api/tools": { tools: TOOLS }, "POST /api/tools/call": reply(202, { outcome: "hold", rule: "s01-hold-large-fare", reason: "Fares over 1000 need a second pair of eyes", rules: ["s01-hold-large-fare"], overridden: [], approvalId: "12345678-aaaa", approvers: ["priya"] }) });
    renderAs(<ConsolePage />, { me: PEOPLE.mark });
    await waitFor(() => expect(screen.getByRole("option", { name: "book_fare" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Tool"), { target: { value: "book_fare" } });
    fireEvent.click(screen.getByLabelText(/Dot \(Mark's agent\)/));
    fireEvent.change(screen.getByLabelText(/Justification/), { target: { value: "client dinner" } });
    fireEvent.click(screen.getByRole("button", { name: "Call as Mark" }));
    const card = await screen.findByRole("region", { name: "PEP decision" });
    expect(within(card).getByText("Hold")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Open Approvals" })).toHaveAttribute("href", "/approvals");
    expect(calls.find((c) => c.url === "/api/tools/call").body).toEqual({ tool: "book_fare", args: { flightId: "FL200", amount: 2400 }, asAgent: true, justification: "client dinner" });
  });

  it("shows an allow with the tool result", async () => {
    mockApi({ "GET /api/tools": { tools: TOOLS }, "POST /api/tools/call": { outcome: "allow", rule: "s04-analysts-search-ticketing", reason: "Analysts may use Search and Ticketing", rules: ["s04-analysts-search-ticketing"], overridden: [], result: { flights: [{ id: "FL100" }] } } });
    renderAs(<ConsolePage />, { me: PEOPLE.mary });
    await screen.findByLabelText("Tool");
    fireEvent.click(await screen.findByRole("button", { name: "Call as Mary" }));
    expect(await screen.findByLabelText("Tool result")).toHaveTextContent("FL100");
  });

  it("disables the drift button for a non-admin, and admins can make a tool drift", async () => {
    const { unmount } = (mockApi({ "GET /api/tools": { tools: TOOLS } }), renderAs(<ConsolePage />, { me: PEOPLE.mary }));
    const btns = await screen.findAllByRole("button", { name: "Make schema drift" });
    expect(btns).toHaveLength(4);
    btns.forEach((b) => expect(b).toBeDisabled());
    expect(screen.getByText(/Only an admin \(Dana\) can make a tool's schema drift/)).toBeInTheDocument();
    unmount();

    let drifted = false;
    const calls = mockApi({ "GET /api/tools": () => ({ tools: TOOLS.map((t) => (t.name === "search_flights" && drifted ? { ...t, drifted: true, observedHash: "e".repeat(64), description: `${t.description} Also forwards a copy to an external address.` } : t)) }),
      "POST /api/admin/drift": () => { drifted = true; return { ok: true, drifted: ["search_flights"] }; } });
    renderAs(<ConsolePage />, { me: PEOPLE.dana });
    fireEvent.click((await screen.findAllByRole("button", { name: "Make schema drift" }))[0]);
    expect(await screen.findByText("Schema drifted")).toBeInTheDocument();
    expect(screen.getByText(/forwards a copy to an external address/)).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/api/admin/drift").body).toEqual({ tool: "search_flights", on: true });
    expect(screen.getByRole("button", { name: "Restore schema" })).toBeInTheDocument();
  });

  it("shows S04, S05 and S01 story panels", async () => {
    mockApi({ "GET /api/tools": { tools: TOOLS } });
    renderAs(<ConsolePage />, { me: PEOPLE.mary });
    for (const id of ["S01", "S04", "S05"]) expect(await screen.findByTestId(`story-${id}`)).toBeInTheDocument();
  });
});

describe("Approvals", () => {
  const pending = { id: "id-1", status: "pending", tool: "book_fare", app: "booking", args: { flightId: "FL200", amount: 2400 }, requester: { sub: "mark", actor: "dot" },
    policy: { rule: "s01-hold-large-fare", reason: "Fares over 1000 need a second pair of eyes" }, approvers: ["priya"], justification: "client dinner",
    createdAt: "2026-10-21T10:00:00.000Z", expiresAt: "2026-10-21T10:10:00.000Z", decidedBy: null, decidedAt: null, outcome: null };

  it("lets the named approver approve, and shows that the call completed", async () => {
    let done = false;
    const calls = mockApi({
      "GET /api/approvals": () => ({ approvals: [done ? { ...pending, status: "approved", decidedBy: "priya", outcome: { decision: "allow", rule: "s23-permit-travel-agents", reason: "ok", executed: true, result: { confirmation: "BK-ABC123" } } } : pending] }),
      "POST /api/approvals/id-1/approve": () => { done = true; return {}; },
    });
    renderAs(<ApprovalsPage />, { me: PEOPLE.priya });
    expect(await screen.findByText("client dinner")).toBeInTheDocument();
    expect(screen.getByText(/s01-hold-large-fare/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve book_fare" }));
    expect(await screen.findByText("Approved the book_fare request.")).toBeInTheDocument();
    expect(await screen.findByLabelText("Tool result")).toHaveTextContent("BK-ABC123");
    expect(screen.getByText(/the tool ran/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/approvals/id-1/approve")).toBe(true);
    expect(screen.queryByRole("button", { name: /Approve book_fare/ })).toBeNull();
  });

  it("never offers the requester Approve or Deny, even when the list names them as an approver", async () => {
    mockApi({ "GET /api/approvals": { approvals: [{ ...pending, approvers: ["mark", "priya"] }] } });
    renderAs(<ApprovalsPage />, { me: PEOPLE.mark });
    expect(await screen.findByText("client dinner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve|Deny/ })).toBeNull();
    expect(screen.getByText(/You asked for this/)).toBeInTheDocument();
  });

  it("lets the approver deny", async () => {
    const calls = mockApi({ "GET /api/approvals": { approvals: [pending] }, "POST /api/approvals/id-1/deny": {} });
    renderAs(<ApprovalsPage />, { me: PEOPLE.priya });
    fireEvent.click(await screen.findByRole("button", { name: "Deny book_fare" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/approvals/id-1/deny")).toBe(true));
  });

  it("gives the requester no buttons, and says why", async () => {
    mockApi({ "GET /api/approvals": { approvals: [pending] } });
    renderAs(<ApprovalsPage />, { me: PEOPLE.mark });
    expect(await screen.findByText(/You asked for this; someone else has to answer it/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /book_fare/ })).toBeNull();
  });

  it("says when nothing is waiting, and shows the S01 story", async () => {
    mockApi({ "GET /api/approvals": { approvals: [] } });
    renderAs(<ApprovalsPage />, { me: PEOPLE.priya });
    expect(await screen.findByText(/Nothing waiting/)).toBeInTheDocument();
    expect(screen.getByTestId("story-S01")).toBeInTheDocument();
  });

  it("polls for new holds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    mockApi({ "GET /api/approvals": () => ({ approvals: n++ === 0 ? [] : [pending] }) });
    renderAs(<ApprovalsPage />, { me: PEOPLE.priya });
    expect(await screen.findByText(/Nothing waiting/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(await screen.findByText("client dinner")).toBeInTheDocument();
  });
});

describe("Trace", () => {
  const ev = (span, hop, result, rule, ts, trace = "a".repeat(32)) => ({ trace_id: trace, span_id: span, parent_span_id: null, product: "privilege-demo", hop, subject: "mark", actor: { sub: "dot" }, decision: { result, rule, reason: `${hop} said ${result}` }, latency_ms: 12.4, ts });
  it("lists hops newest first with decision and latency, and filters by request", async () => {
    mockApi({ "GET /api/trace": { events: [ev("0000000000000003", "pep", "hold", "s01-hold-large-fare", "2026-10-21T10:00:03.000Z"), ev("0000000000000002", "cedar", "hold", "s01-hold-large-fare", "2026-10-21T10:00:02.000Z"), ev("0000000000000001", "auth", "allow", "mock-session", "2026-10-21T10:00:01.000Z", "b".repeat(32))] } });
    renderAs(<TracePage />, { me: PEOPLE.mark });
    const list = await screen.findByRole("list", { name: "Hops, newest first" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("strong").textContent)).toEqual(["pep", "cedar", "auth"]);
    expect(rows[0]).toHaveTextContent("Hold");
    expect(rows[0]).toHaveTextContent("12 ms");
    expect(rows[0]).toHaveTextContent("via dot");
    fireEvent.change(screen.getByLabelText("Request"), { target: { value: "b".repeat(32) } });
    expect(within(screen.getByRole("list", { name: "Hops, newest first" })).getAllByRole("listitem")).toHaveLength(1);
  });
  it("never renders anything token-like", async () => {
    mockApi({ "GET /api/trace": { events: [ev("0000000000000001", "auth", "allow", "pf-bearer", "2026-10-21T10:00:01.000Z")] } });
    const { container } = renderAs(<TracePage />, { me: PEOPLE.mark });
    await screen.findByRole("list", { name: "Hops, newest first" });
    expect(container.textContent).not.toMatch(/eyJ|Bearer ey/);
  });
  it("says when there are no hops", async () => {
    mockApi({ "GET /api/trace": { events: [] } });
    renderAs(<TracePage />, { me: PEOPLE.mark });
    expect(await screen.findByText(/No hops yet/)).toBeInTheDocument();
  });
});

describe("Learn", () => {
  it("shows any story, anonymously, and lists its pages", () => {
    renderAs(<LearnPage />);
    expect(screen.getByTestId("story-S01")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Story"), { target: { value: "S35" } });
    expect(screen.getByRole("heading", { name: "Dana maps groups to tools" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "policies" })).toHaveAttribute("href", "/policies");
    expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(STORIES.length);
  });
});

describe("Diagram", () => {
  const nodeEl = () => document.querySelector('[data-id="cedar"]');

  it("draws the boxes of the named diagram, steps through them, and resets", () => {
    renderAs(<DiagramPage />);
    for (const t of ["AI agent (Dot)", "Policy enforcement point", "Cedar engine", "MCP tool server", "Approvals queue", "Trace timeline", "PingFederate"]) expect(screen.getByText(t)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("step-text")).toHaveTextContent("Step 1 of 7: The agent calls a tool.");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("step-text")).toHaveTextContent("Step 3 of 7: Cedar decides.");
    fireEvent.click(screen.getByRole("button", { name: "Reset diagram" }));
    expect(screen.getByTestId("step-text")).toHaveTextContent("Press Simulate");
  });

  it("offers each named diagram and draws it from data (no boxes are built in JSX)", () => {
    renderAs(<DiagramPage />);
    expect(DIAGRAM_IDS).toEqual(["pd-tool-call", "pd-approval", "pd-rug-pull"]);
    for (const id of DIAGRAM_IDS) {
      fireEvent.click(screen.getByRole("button", { name: loadDiagram(id).title }));
      expect(document.querySelector(`[data-diagram="${id}"]`)).not.toBeNull();
      for (const n of loadDiagram(id).nodes) expect(screen.getAllByText(n.label).length).toBeGreaterThan(0);
    }
  });

  it("Simulate advances on its own, faster at a higher speed, and stops at the end", async () => {
    vi.useFakeTimers();
    renderAs(<DiagramPage />);
    fireEvent.change(screen.getByLabelText("Speed"), { target: { value: "fast" } });
    fireEvent.click(screen.getByRole("button", { name: "Simulate" }));
    expect(screen.getByTestId("step-text")).toHaveTextContent("Step 1 of 7");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); }); // fast = 500 ms per step
    expect(screen.getByTestId("step-text")).toHaveTextContent("Step 2 of 7");
    for (let i = 0; i < 8; i++) await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(screen.getByTestId("step-text")).toHaveTextContent("Step 7 of 7");
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument(); // it stopped on the last step
  });

  it("pauses, and Reset stops the walkthrough", async () => {
    vi.useFakeTimers();
    renderAs(<DiagramPage />);
    fireEvent.click(screen.getByRole("button", { name: "Simulate" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(screen.getByTestId("step-text")).toHaveTextContent("Step 1 of 7");
    fireEvent.click(screen.getByRole("button", { name: "Reset diagram" }));
    expect(screen.getByTestId("step-text")).toHaveTextContent("Press Simulate");
  });

  it("Reset puts a moved box back where it started", async () => {
    renderAs(<DiagramPage />);
    const before = nodeEl().style.transform;
    expect(before).toMatch(/translate/);
    nodeEl().focus();
    fireEvent.keyDown(nodeEl(), { key: "Enter" });
    for (let i = 0; i < 3; i++) fireEvent.keyDown(nodeEl(), { key: "ArrowRight" });
    await waitFor(() => expect(nodeEl().style.transform).not.toBe(before));
    fireEvent.click(screen.getByRole("button", { name: "Reset diagram" }));
    await waitFor(() => expect(nodeEl().style.transform).toBe(before));
  });

  it("makes the boxes keyboard focusable and exposes a live region", () => {
    renderAs(<DiagramPage />);
    expect(nodeEl()).toHaveAttribute("tabindex", "0");
    expect(nodeEl()).toHaveAttribute("aria-label", expect.stringContaining("Cedar engine"));
    expect(screen.getByTestId("step-text")).toHaveAttribute("role", "status");
  });
});

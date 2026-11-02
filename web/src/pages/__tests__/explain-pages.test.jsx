// The explanations on the pages: Tool console and Test a request (ResultCard), AI Policies (meaning, examples, preview), Trace and Approvals.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import ApprovalsPage from "../ApprovalsPage";
import ConsolePage from "../ConsolePage";
import PoliciesPage from "../PoliciesPage";
import TracePage from "../TracePage";
import fixtures from "../../components/__tests__/fixtures/explanations.json";
import { reloadStoryPrefs } from "../../story/useStoryPrefs";
import { PEOPLE, TOOLS, mockApi, renderAs, reply } from "../../testUtils";

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } reloadStoryPrefs(); });
const MOCK = { idp: "local-mock", mockAvailable: true, bearer: false, mode: "mock" };

const meaning = (over) => ({ state: "active", explainedFrom: "structure", unexplained: [], source: "forbid (...);", combines: "A block rule always beats an allow rule.", who: { text: "anyone", groups: [], anyone: true },
  attended: { applies: "both", text: "calls (attended or unattended)" }, what: { text: "the book_fare tool", tools: null, apps: null }, conditions: [], approval: null, ...over });
const POLICIES = [
  { id: "s23-forbid-over-cap", state: "active", text: "forbid-cap", effect: "forbid", reason: "Hard cap: no booking over 10000 for anyone", approvers: null,
    meaning: meaning({ id: "s23-forbid-over-cap", kind: "block", kindLabel: "Block rule", cedar: "forbid", oneLine: "Blocks calls to the book_fare tool when the amount is over 10000.", does: "Blocks calls to the book_fare tool when the amount is over 10000.", conditions: [{ kind: "when", text: "the amount is over 10000" }], reason: "Hard cap: no booking over 10000 for anyone" }) },
  { id: "s23-permit-travel-agents", state: "active", text: "permit-ta", effect: "permit", reason: "Travel agents may book fares", approvers: null,
    meaning: meaning({ id: "s23-permit-travel-agents", kind: "allow", kindLabel: "Allow rule", cedar: "permit", oneLine: "Lets people in the travel-agents group book.", does: "Lets people in the travel-agents group book.", reason: "Travel agents may book fares" }) },
  { id: "s01-hold-large-fare", state: "active", text: "hold", effect: "forbid", reason: "Fares over 1000 need a second pair of eyes", approvers: "priya",
    meaning: meaning({ id: "s01-hold-large-fare", kind: "hold", kindLabel: "Hold rule", cedar: "forbid", oneLine: "Holds unattended calls.", does: "Holds unattended calls.", approval: { approvers: [{ sub: "priya", name: "Priya" }], clearsOnApproval: true } }) },
  { id: "t-odd", state: "active", text: "forbid odd", effect: "forbid", reason: "Odd shape", approvers: null,
    meaning: meaning({ id: "t-odd", kind: "block", kindLabel: "Block rule", cedar: "forbid", explainedFrom: "text", does: "Explained from its text: “Odd shape”.", oneLine: "Explained from its text: “Odd shape”.", unexplained: ["(context.args.amount * 2) > 100"], source: "forbid odd", reason: "Odd shape" }) },
];
const decide = (b) => {
  if (b.explain) return { outcome: "deny", decision: "deny", rule: "s23-forbid-over-cap", rules: [], overridden: [], reason: "r", problems: [], approvers: [], shadow: null, explanation: fixtures["C-block-overrides-allow"] };
  if (b.args?.amount === 12000) return { outcome: "deny", rule: "s23-forbid-over-cap", overridden: ["s23-permit-travel-agents"] };
  if (b.args?.amount === 2400 && b.claims.act) return { outcome: "hold", rule: "s01-hold-large-fare", overridden: [] };
  return { outcome: "allow", rule: "s23-permit-travel-agents", overridden: [] };
};
const routes = (extra = {}) => ({ "GET /api/tools": { tools: TOOLS }, "GET /api/policies": { policies: POLICIES, error: null }, "POST /api/decide-test": decide, ...extra });

describe("Tool console decision card", () => {
  it("leads with the plain-English explanation, keeps the raw facts in Technical details, and shows the outcome word once", async () => {
    mockApi({ "GET /api/tools": { tools: TOOLS }, "POST /api/tools/call": { outcome: "deny", rule: "s23-forbid-over-cap", reason: "Hard cap", rules: ["s23-forbid-over-cap"], overridden: ["s23-permit-travel-agents"], problems: [], explanation: fixtures["C-block-overrides-allow"] } });
    renderAs(<ConsolePage />, { me: PEOPLE.mark, config: MOCK });
    await waitFor(() => expect(screen.getByRole("option", { name: "book_fare" })).toBeInTheDocument(), { timeout: 10000 });
    fireEvent.click(screen.getByRole("button", { name: "Call as Mark" }));
    const card = await screen.findByRole("region", { name: "PEP decision" });
    expect(within(card).getByRole("heading", { level: 3 })).toHaveTextContent("Decision");
    expect(within(card).getByText("Deny")).toBeInTheDocument();
    expect(within(card).getByText(/^Denied\. A block rule applies/)).toBeInTheDocument();
    expect(within(card).getByRole("heading", { name: "Why" })).toBeInTheDocument();
    expect(within(card).getByText("Technical details")).toBeInTheDocument();
    expect(within(card).getByText("Overridden policies")).toBeInTheDocument();
  });
  it("with no explanation (an older server) the original card is unchanged", async () => {
    mockApi({ "GET /api/tools": { tools: TOOLS }, "POST /api/tools/call": { outcome: "deny", rule: "default-deny", reason: "No policy permits this", rules: [], overridden: [], problems: [] } });
    renderAs(<ConsolePage />, { me: PEOPLE.mary, config: MOCK });
    await waitFor(() => expect(screen.getByRole("option", { name: "book_fare" })).toBeInTheDocument(), { timeout: 10000 });
    fireEvent.click(screen.getByRole("button", { name: "Call as Mary" }));
    const card = await screen.findByRole("region", { name: "PEP decision" });
    expect(within(card).queryByText("Technical details")).toBeNull();
    expect(within(card).getByText("Deciding policy")).toBeInTheDocument();
  });
});

describe("AI Policies", () => {
  it("names each rule as an Allow, Block or Hold rule, with its meaning, and keeps the author's reason and the approvers", async () => {
    mockApi(routes());
    renderAs(<PoliciesPage />, { me: PEOPLE.mary, config: MOCK });
    expect(await screen.findByText("Allow rule")).toBeInTheDocument();
    expect(screen.getAllByText("Block rule").length).toBeGreaterThan(0);
    expect(screen.getByText("Hold rule")).toBeInTheDocument();
    expect(screen.getByText(/Fares over 1000 need a second pair of eyes · approvers: priya/)).toBeInTheDocument();
    expect(screen.getByText("Holds unattended calls.", { selector: ".list-item__why" })).toBeInTheDocument();
    expect(screen.getByText(/Every rule is checked on every call\. A block rule always beats an allow rule\. If no rule applies, the call is denied\./)).toBeInTheDocument();
    expect(screen.getByText("What do these words mean?")).toBeInTheDocument();
  });
  it("selecting a rule explains it and shows examples that were computed from real answers", async () => {
    mockApi(routes());
    renderAs(<PoliciesPage />, { me: PEOPLE.mary, config: MOCK });
    fireEvent.click(await screen.findByRole("button", { name: /s23-forbid-over-cap/ }));
    const card = await screen.findByRole("heading", { name: "What this rule means" });
    const meaningCard = card.closest("section");
    expect(within(meaningCard).getByText("Blocks calls to the book_fare tool when the amount is over 10000.", { selector: ".meaning__does" })).toBeInTheDocument();
    expect(within(meaningCard).getByText("When the amount is over 10000")).toBeInTheDocument();
    await waitFor(() => expect(within(meaningCard).getByText(/Example: Mark books a fare over the hard cap/)).toBeInTheDocument());
    expect(within(meaningCard).getByText(/Computed just now by the real rules\./)).toBeInTheDocument();
  });
  it("a staged candidate never borrows the active rule's example (the same id, different text)", async () => {
    const candidate = { ...POLICIES[0], state: "candidate", text: "forbid-cap-v2", meaning: { ...POLICIES[0].meaning, state: "candidate", does: "Candidate wording.", oneLine: "Candidate wording." } };
    mockApi(routes({ "GET /api/policies": { policies: [...POLICIES, candidate], error: null } }));
    renderAs(<PoliciesPage />, { me: PEOPLE.mary, config: MOCK });
    const rows = await screen.findAllByRole("button", { name: /s23-forbid-over-cap/ });
    expect(rows).toHaveLength(2);
    fireEvent.click(rows.find((r) => r.textContent.includes("Candidate")));
    const meaningCard = (await screen.findByRole("heading", { name: "What this rule means" })).closest("section");
    expect(within(meaningCard).getByText("Candidate wording.", { selector: ".meaning__does" })).toBeInTheDocument();
    expect(within(meaningCard).getByText(/No sample request is decided by this rule\./)).toBeInTheDocument();
    expect(within(meaningCard).queryByText(/Example:/)).toBeNull();
    fireEvent.click(rows.find((r) => r.textContent.includes("Active")));
    expect(await screen.findByText(/Example: Mark books a fare over the hard cap/)).toBeInTheDocument();
  });
  it("a rule that decides nothing says so instead of inventing an example", async () => {
    mockApi(routes());
    renderAs(<PoliciesPage />, { me: PEOPLE.mary, config: MOCK });
    fireEvent.click(await screen.findByRole("button", { name: /t-odd/ }));
    const meaningCard = (await screen.findByRole("heading", { name: "What this rule means" })).closest("section");
    expect(within(meaningCard).getByText(/No sample request is decided by this rule\./)).toBeInTheDocument();
  });
  it("a rule that cannot be explained structurally is bannered 'Explained from its text' with its source and the raw clause", async () => {
    mockApi(routes());
    renderAs(<PoliciesPage />, { me: PEOPLE.mary, config: MOCK });
    fireEvent.click(await screen.findByRole("button", { name: /t-odd/ }));
    const meaningCard = (await screen.findByRole("heading", { name: "What this rule means" })).closest("section");
    expect(within(meaningCard).getByText("Explained from its text.")).toBeInTheDocument();
    expect(within(meaningCard).getByText("(context.args.amount * 2) > 100")).toBeInTheDocument();
    expect(within(meaningCard).getByText("Cedar source")).toBeInTheDocument();
    expect(within(meaningCard).queryByText("Who it covers")).toBeNull();
  });
  it("while an admin types, the unsaved text is explained as a preview", async () => {
    const calls = mockApi(routes({ "POST /api/policies/explain": (b) => ({ ok: true, meaning: meaning({ id: b.id, kind: "block", kindLabel: "Block rule", cedar: "forbid", does: "PREVIEW: now over 7.", oneLine: "PREVIEW", reason: null }) }) }));
    renderAs(<PoliciesPage />, { me: PEOPLE.dana, config: MOCK });
    fireEvent.click(await screen.findByRole("button", { name: /s23-forbid-over-cap/ }));
    fireEvent.change(screen.getByLabelText(/Cedar text/), { target: { value: "forbid changed" } });
    expect(await screen.findByText("PREVIEW: now over 7.", { selector: ".meaning__does" }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/Preview of your unsaved text\./)).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/api/policies/explain").body).toMatchObject({ id: "s23-forbid-over-cap", text: "forbid changed" });
  });
  it("Test a request asks for the explanation and shows it", async () => {
    const calls = mockApi(routes());
    renderAs(<PoliciesPage />, { me: PEOPLE.mark, config: MOCK });
    fireEvent.click(await screen.findByRole("button", { name: "Test request" }));
    const card = await screen.findByRole("region", { name: "Decision" });
    expect(await within(card).findByText(/^Denied\. A block rule applies/)).toBeInTheDocument();
    expect(calls.filter((c) => c.url === "/api/decide-test").pop().body.explain).toBe(true);
  });
});

describe("Trace and Approvals", () => {
  const ev = (span, hop, result, ts) => ({ trace_id: "a".repeat(32), span_id: span, parent_span_id: null, product: "privilege-demo", hop, subject: "mark", actor: null, decision: { result, rule: "s23-forbid-over-cap", reason: `${hop} said ${result}` }, latency_ms: 12, ts });
  it("Trace glosses each hop and folds the explanation of the final decision under 'Why this decision'", async () => {
    mockApi({ "GET /api/trace": { events: [ev("0000000000000002", "pep", "deny", "2026-10-21T10:00:02.000Z"), ev("0000000000000001", "auth", "allow", "2026-10-21T10:00:01.000Z")], explanations: { "0000000000000002": fixtures["C-block-overrides-allow"] } } });
    renderAs(<TracePage />, { me: PEOPLE.mark });
    expect(await screen.findByText("Final decision")).toBeInTheDocument();
    expect(screen.getByText("Sign-in check")).toBeInTheDocument();
    expect(screen.getByText(/The "Final decision" row is the one that matters\./)).toBeInTheDocument();
    expect(screen.getAllByText("Why this decision")).toHaveLength(1);
    const fold = screen.getByText("Why this decision").closest("details");
    expect(within(fold).getByRole("heading", { name: "Why" })).toBeInTheDocument();
  });
  it("Approvals shows why it was held, says what approving does, and shows the answer's explanation afterwards", async () => {
    const pending = { id: "id-1", status: "pending", tool: "book_fare", app: "booking", args: { amount: 2400 }, requester: { sub: "mark", actor: "dot" }, policy: { rule: "s01-hold-large-fare", reason: "Fares" },
      approvers: ["priya"], justification: null, createdAt: "2026-10-21T10:00:00.000Z", expiresAt: "2026-10-21T10:10:00.000Z", decidedBy: null, decidedAt: null, outcome: null, explanation: fixtures["D-hold"] };
    mockApi({ "GET /api/approvals": { approvals: [pending, { ...pending, id: "id-2", status: "approved", outcome: { decision: "allow", rule: "r", reason: "ok", executed: true, explanation: { ...fixtures["A-allow"], headline: "Priya approved. book_fare ran once." } } }] } });
    renderAs(<ApprovalsPage />, { me: PEOPLE.priya });
    expect(await screen.findByText("Why this was held")).toBeInTheDocument();
    expect(screen.getByText("Held. Priya must approve this before book_fare runs.")).toBeInTheDocument();
    expect(screen.getByText("If you approve, the rules are checked again with one approval recorded and the tool runs once.")).toBeInTheDocument();
    expect(screen.getByText("Why it ended this way")).toBeInTheDocument();
    expect(screen.getByText("Priya approved. book_fare ran once.")).toBeInTheDocument();
  });
});

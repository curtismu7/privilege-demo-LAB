// Try this: buttons fill in the form and promise nothing they cannot keep. The expectations themselves are proved against the real server
// in server/test/app/tryit.test.js; here: what the card shows and what a click does.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConsolePage from "../../pages/ConsolePage";
import { reloadStoryPrefs } from "../../story/useStoryPrefs";
import { PEOPLE, TOOLS, mockApi, renderAs } from "../../testUtils";
import TryThis from "../TryThis";

const MOCK = { idp: "local-mock", mockAvailable: true, bearer: false, mode: "mock" };
beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } reloadStoryPrefs(); });
const sc = (over = {}) => ({ id: "a", label: "Mark books a normal fare", as: "mark", asName: "Mark", tool: "book_fare", args: { flightId: "FL200", amount: 800 }, agent: false, note: "Allowed: x.", expect: { outcome: "allow", rule: "r" }, ...over });

describe("TryThis card", () => {
  const props = { me: { persona: "mark" }, mode: "mock", tools: TOOLS, onFill: () => {} };
  it("one button per scenario with what to expect in words, and example-only probes are not buttons", () => {
    renderAs(<TryThis {...props} scenarios={[sc(), sc({ id: "p", label: "probe", exampleOnly: true })]} />);
    expect(screen.getByRole("heading", { name: "Try this" })).toBeInTheDocument();
    expect(screen.getByText("Each button fills in the form below. It does not make the call.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark books a normal fare" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "probe" })).toBeNull();
    expect(screen.getByText(/Expect:/).textContent).toContain("Allow");
    expect(screen.getByText(/Allowed: x\./)).toBeInTheDocument();
  });
  it("says who a scenario was written for when someone else is signed in", () => {
    renderAs(<TryThis {...props} me={{ persona: "mary" }} scenarios={[sc()]} />);
    expect(screen.getByText("Written for Mark. Sign in as Mark to get this result.")).toBeInTheDocument();
    // the expectation is labelled as Mark's and the row is dimmed, so it does not read as the result for the signed-in person
    expect(screen.getByText(/Expect, as Mark:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark books a normal fare" }).closest("li")).toHaveClass("try__item--other");
    // and it cannot be pressed: the call would run as Mary and not give the result printed beside it
    expect(screen.getByRole("button", { name: "Mark books a normal fare" })).toBeDisabled();
  });
  it("a scenario written for the signed-in person is plain 'Expect:' and not dimmed", () => {
    renderAs(<TryThis {...props} scenarios={[sc()]} />);
    expect(screen.getByText(/^Expect:/)).toBeInTheDocument();
    expect(screen.queryByText(/Written for/)).toBeNull();
    expect(screen.getByRole("button", { name: "Mark books a normal fare" }).closest("li")).not.toHaveClass("try__item--other");
  });
  it("is disabled for a tool the server does not offer, and hidden outside mock mode", () => {
    const { unmount } = renderAs(<TryThis {...props} scenarios={[sc({ tool: "nope" })]} />);
    expect(screen.getByRole("button", { name: "Mark books a normal fare" })).toBeDisabled();
    unmount();
    renderAs(<TryThis {...props} mode="live" scenarios={[sc()]} />);
    expect(screen.queryByRole("heading", { name: "Try this" })).toBeNull();
  });
});

describe("Tool console: Try this fills the form and does not call", () => {
  async function open(me = PEOPLE.mark, config = MOCK) {
    const calls = mockApi({ "GET /api/tools": { tools: TOOLS }, "POST /api/tools/call": {} });
    renderAs(<ConsolePage />, { me, config });
    await waitFor(() => expect(screen.getByRole("option", { name: "book_fare" })).toBeInTheDocument(), { timeout: 10000 });
    return calls;
  }
  it("a normal fare: tool, arguments and the agent box are filled, nothing is sent, the status is announced, focus moves to Call", async () => {
    const calls = await open();
    fireEvent.click(screen.getByLabelText(/Dot \(Mark's agent\)/)); // start ticked, to prove the button clears it
    fireEvent.click(screen.getByRole("button", { name: "Mark books a normal fare" }));
    expect(screen.getByLabelText("Tool")).toHaveValue("book_fare");
    expect(screen.getByLabelText("amount", { selector: "input" })).toHaveValue(800);
    expect(screen.getByLabelText(/Dot \(Mark's agent\)/)).not.toBeChecked();
    expect(screen.getByText("Filled in: Mark books a normal fare. Press “Call as Mark” to run it.")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Call as Mark" }));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
  it("a large fare booked by the agent ticks the box and fills 2400; the signed-in person does not change", async () => {
    const calls = await open();
    fireEvent.click(screen.getByRole("button", { name: /Mark's agent books a large fare/ }));
    expect(screen.getByLabelText(/Dot \(Mark's agent\)/)).toBeChecked();
    expect(screen.getByLabelText("amount", { selector: "input" })).toHaveValue(2400);
    expect(screen.getByRole("button", { name: "Call as Mark" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Call as Mark" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/tools/call?envelope=1")).toBe(true));
    expect(calls.find((c) => c.url === "/api/tools/call?envelope=1").body).toEqual({ tool: "book_fare", args: { flightId: "FL200", amount: 2400 }, asAgent: true });
  });
  it("clears the previous result and the justification", async () => {
    await open();
    fireEvent.change(screen.getByLabelText(/Justification/), { target: { value: "because" } });
    fireEvent.click(screen.getByRole("button", { name: "Call as Mark" }));
    await screen.findByRole("region", { name: "PEP decision" });
    fireEvent.click(screen.getByRole("button", { name: "Mark pays an invoice" }));
    expect(screen.queryByRole("region", { name: "PEP decision" })).toBeNull();
    expect(screen.getByLabelText(/Justification/)).toHaveValue("");
    expect(screen.getByLabelText("Tool")).toHaveValue("pay_invoice");
  });
  it("someone else signed in: the button is disabled and says who it is written for; a button for the signed-in person works", async () => {
    const calls = await open(PEOPLE.mary);
    expect(screen.getAllByText(/Written for Mark\. Sign in as Mark to get this result\./).length).toBeGreaterThan(0);
    expect(within(screen.getByRole("heading", { name: "Try this" }).closest("section")).queryByText(/Written for Mary/)).toBeNull(); // the Mary scenarios need no hint
    expect(screen.getByRole("button", { name: "Mark pays an invoice" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mary searches flights" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Mary tries to book a fare" }));
    expect(screen.getByLabelText("Tool")).toHaveValue("book_fare");
    expect(screen.getByLabelText("amount", { selector: "input" })).toHaveValue(800);
    expect(screen.getByRole("button", { name: "Call as Mary" })).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
  it("in live mode there is no Try this card", async () => {
    await open(PEOPLE.mark, { ...MOCK, mode: "live" });
    expect(screen.queryByRole("heading", { name: "Try this" })).toBeNull();
  });
  it("shows the three-step strip, the agent helper text, and the glossary", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Tool"), { target: { value: "book_fare" } });
    expect(screen.getByRole("heading", { name: "How this works" })).toBeInTheDocument();
    expect(screen.getByText(/Tick this to let Dot make the call for you\. A call made by an agent is unattended/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Dot \(Mark's agent\)/)).toHaveAccessibleDescription(/unattended/);
    expect(screen.getByText("What do these words mean?")).toBeInTheDocument();
    expect(screen.getByText("Rules can set limits on this number.")).toBeInTheDocument();
  });
});

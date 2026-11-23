import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RunObs, { GatewayRunObs } from "../RunObs";
import GatewayCheckCard from "../../privilege-check/GatewayCheckCard";
import ConsolePage from "../../pages/ConsolePage";
import { PEOPLE, TOOLS, mockApi, renderAs, reply } from "../../testUtils";
import { setJsonView } from "../JsonPane";
// Records come from the lab's own builder, so the page is tested against the shape the server really sends.
import { createRunLog } from "../../../../server/src/runLog.js";
import { gatewayCheckExchanges } from "../../../../server/src/gatewayExchanges.js";

beforeEach(() => setJsonView("raw"));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setJsonView("form"); });

const T = Date.UTC(2026, 10, 22, 10, 0, 0);
const claims = { sub: "mark", groups: ["travel-agents"], act: { sub: "dot" } };
const OUT = {
  allow: { outcome: "allow", rule: "s23-permit-travel-agents", reason: "Travel agents may book fares", rules: [], result: { ok: true } },
  hold: { outcome: "hold", rule: "s01-hold-large-fare", reason: "Fares over 1000 need a second pair of eyes", rules: [], approvers: ["priya"], approvalId: "ap-1" },
};
async function made(kind, mode = "mock") {
  const log = createRunLog({ now: () => T, mode: () => mode });
  const id = log.tool({ claims, source: "session", persona: "mark", viaFlag: true, tool: "book_fare", out: OUT[kind] });
  const run = log.find(id, mode).run;
  return { id, run, record: await log.record(run) };
}
const answerOf = ({ record, run }) => ({ record, run: { id: run.id, open: run.open, mode: run.mode } });

describe("the console's run record", () => {
  it("before any call: the empty state and the lab's one-line note, and no request", () => {
    const calls = mockApi({});
    render(<RunObs res={null} source="mock" />);
    expect(screen.getByTestId("ro-empty")).toHaveTextContent(/Run the demo/);
    expect(screen.getByTestId("ro-lab-note")).toHaveTextContent(/lab's own Cedar PEP \(a Privilege-style simulation\), not Privilege itself, and Authorize is not used/);
    expect(calls).toHaveLength(0);
  });

  it("an attempt that began no run says so, makes no request and shows no older record", () => {
    const calls = mockApi({});
    const { rerender } = render(<RunObs res={{ outcome: "error", rule: "request-failed" }} source="mock" />);
    expect(screen.getByTestId("ro-no-run")).toHaveTextContent("This attempt began no run");
    expect(screen.queryByTestId("run-observability")).toBeNull();
    rerender(<RunObs res={{ outcome: "deny" }} source="mock" />);
    expect(screen.getByTestId("ro-no-run")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("a permitted run: a loading state first, then the panel with the mock label, asked for by its run id", async () => {
    const m = await made("allow");
    const calls = mockApi({ "GET /api/run-observability": answerOf(m) });
    render(<RunObs res={{ runId: m.id }} source="mock" />);
    expect(screen.getByTestId("ro-loading")).toHaveTextContent("Collecting this run's logs…");
    expect(await screen.findByTestId("run-observability")).toBeInTheDocument();
    expect(screen.getByTestId("ro-basis")).toHaveTextContent(/Simulated/);
    expect(screen.getByTestId("ro-coverage-privilege")).toHaveTextContent("Simulated");
    expect(screen.getByTestId("ro-coverage-authorize")).toHaveTextContent("Not logged");
    expect(screen.getByTestId("ro-reason-authorize")).toHaveTextContent(/does not call PingOne Authorize/);
    expect(screen.getByTestId("ro-lab-note")).toBeInTheDocument();
    expect(calls.map((c) => c.url)).toEqual([`/api/run-observability?runId=${m.id}`]);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(1); // a closed run is not asked for again
  });

  it("a held run stays open: it is read again every few seconds until the answer closes it, and then no more", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const held = await made("hold");
    expect(held.run.open).toBe(true);
    let n = 0;
    const closed = { ...answerOf(held), run: { id: held.id, open: false, mode: "mock" } };
    const calls = mockApi({ "GET /api/run-observability": () => { n += 1; return n < 3 ? answerOf(held) : closed; } });
    render(<RunObs res={{ runId: held.id }} source="mock" />);
    await screen.findByTestId("run-observability");
    expect(calls).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(calls).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(calls).toHaveLength(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(calls).toHaveLength(3);
  });

  it("a run asked for in the other mode is an alert with the server's words, never the old record under a new label", async () => {
    const m = await made("allow");
    let source = "mock";
    mockApi({ "GET /api/run-observability": () => (source === "mock" ? answerOf(m) : { record: null, message: "That run was made in Mock mode. Switch back to Mock to see it.", reason: "other-mode" }) });
    const { rerender } = render(<RunObs res={{ runId: m.id }} source="mock" />);
    await screen.findByTestId("run-observability");
    source = "real";
    rerender(<RunObs res={{ runId: m.id }} source="real" />);
    expect(screen.queryByTestId("run-observability")).toBeNull(); // not the mock record while the answer is awaited
    expect(await screen.findByTestId("ro-not-shown")).toHaveTextContent("That run was made in Mock mode");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("a new run never shows the previous run's record while it loads", async () => {
    const a = await made("allow");
    const b = await made("hold");
    let release;
    const gate = new Promise((r) => { release = r; });
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes(b.id)) await gate;
      return new Response(JSON.stringify(String(url).includes(b.id) ? answerOf(b) : answerOf(a)), { status: 200 });
    }));
    const { rerender } = render(<RunObs res={{ runId: a.id }} source="mock" />);
    await screen.findByTestId("run-observability");
    rerender(<RunObs res={{ runId: b.id }} source="mock" />);
    expect(screen.queryByTestId("run-observability")).toBeNull();
    expect(screen.getByTestId("ro-loading")).toBeInTheDocument();
    release();
    await waitFor(() => expect(screen.getByTestId("run-observability")).toHaveTextContent(/held book_fare/));
    expect(screen.getByTestId("run-observability")).not.toHaveTextContent(/allowed book_fare/);
  });

  it("a server error and a network failure are alerts; a Live record is the real label with every layer not logged and the Live note", async () => {
    mockApi({ "GET /api/run-observability": reply(400, { error: "bad_simulated_row", message: "A simulated row needs a time." }) });
    const { unmount } = render(<RunObs res={{ runId: "run-x-1" }} source="mock" />);
    expect(await screen.findByTestId("ro-error")).toHaveTextContent("A simulated row needs a time.");
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const second = render(<RunObs res={{ runId: "run-x-2" }} source="mock" />);
    expect(await screen.findByTestId("ro-error")).toHaveTextContent(/HTTP 0|network/);
    second.unmount();
    const live = await made("allow", "live");
    mockApi({ "GET /api/run-observability": answerOf(live) });
    render(<RunObs res={{ runId: live.id }} source="real" />);
    await screen.findByTestId("run-observability");
    expect(screen.getByTestId("ro-basis")).toHaveTextContent(/Real/);
    for (const l of ["person", "agent", "authorize", "privilege", "gateway", "resource"]) expect(screen.getByTestId(`ro-coverage-${l}`)).toHaveTextContent("Not logged");
    // only the placeholder rows that say why: no row is simulated, a response or logged
    expect(screen.getAllByRole("row").filter((r) => r.dataset.origin && r.dataset.origin !== "not-logged")).toHaveLength(0);
    expect(screen.getByTestId("ro-lab-note")).toHaveTextContent(/Live mode: the lab checks the sign-in or Bearer credential itself/);
  });
});

describe("the Tool console mounts the record under the call", () => {
  it("empty before a call; after a call it asks for that run's record, and a failed call says it began no run", async () => {
    const m = await made("allow");
    const out = { outcome: "allow", rule: "r", reason: "x", overridden: [], runId: m.id };
    const calls = mockApi({ "GET /api/tools": { tools: TOOLS }, "POST /api/tools/call": out, "GET /api/run-observability": answerOf(m) });
    renderAs(<ConsolePage />, { me: PEOPLE.mary, config: { mode: "mock", idp: "local-mock", mockAvailable: true } });
    expect(screen.getByTestId("ro-empty")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("option", { name: "pay_invoice" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Call as Mary" }));
    expect(await screen.findByTestId("ro-table")).toBeInTheDocument();
    expect(calls.filter((c) => c.url.startsWith("/api/run-observability")).map((c) => c.url)).toEqual([`/api/run-observability?runId=${m.id}`]);
    // picking another tool clears the call, and the panel goes back to its empty state (not the older record)
    fireEvent.change(screen.getByLabelText("Tool"), { target: { value: "pay_invoice" } });
    expect(await screen.findByTestId("ro-empty")).toBeInTheDocument();
  });

  it("a call whose answer has no run id says the attempt began no run", async () => {
    mockApi({ "GET /api/tools": { tools: TOOLS }, "POST /api/tools/call": { outcome: "deny", rule: "default-deny", reason: "x", overridden: [] } });
    renderAs(<ConsolePage />, { me: PEOPLE.mary });
    await waitFor(() => expect(screen.getByRole("option", { name: "pay_invoice" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Call as Mary" }));
    expect(await screen.findByTestId("ro-no-run")).toBeInTheDocument();
  });

  it("the Live toggle passes the real label to the panel", async () => {
    mockApi({ "GET /api/tools": { tools: TOOLS } });
    renderAs(<ConsolePage />, { me: PEOPLE.mary, config: { mode: "live", idp: "pf", mockAvailable: false } });
    expect(screen.getByTestId("ro-basis")).toHaveTextContent(/Real/);
    expect(screen.getByTestId("ro-lab-note")).toHaveTextContent(/Live mode/);
  });
});

describe("the gateway card's run record", () => {
  const wire = (rpcMethod, status, body) => ({ http: "POST", url: "https://gateway.example/travel-door/mcp", rpcMethod, request: { headers: {}, body: { jsonrpc: "2.0", id: 1, method: rpcMethod, params: {} } }, response: { status, headers: {}, body }, at: "2026-01-01T00:00:00.000Z" });
  const listing = { ok: true, tools: [{ name: "search_flights" }], ms: 5, wire: [wire("initialize", 200, { result: {} }), wire("tools/list", 200, { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "search_flights" }] } })] };
  const { wire: _w, ...shown } = listing;
  const exchanges = gatewayCheckExchanges(listing, undefined);
  const base = { app: "travel-door", caller: "travel_agent", gateway: "https://gateway.example", listing: shown, exchanges };

  it("draws the record the check came back with, as a real record with response rows, without a second gateway call", async () => {
    const log = createRunLog({ now: () => T });
    const { record, noReply } = await log.gatewayCheck({ startedAt: T, caller: "travel_agent", replies: [{ at: T, asked: "tools/list", trace: exchanges[0].trace }, { at: T, asked: "tools/call", control: true, trace: { request: { body: { method: "tools/call" } }, response: null, decisions: [{ id: "reach", outcome: "fail", evidence: "no answer" }] } }] });
    const calls = mockApi({ "GET /api/info": { source: "mock", realAvailable: true }, "POST /api/gateway-check": { ...base, observability: record, noReply } });
    renderAs(<GatewayCheckCard />);
    const panel = await screen.findByTestId("run-observability");
    expect(screen.getByTestId("ro-basis")).toHaveTextContent(/Real/);
    expect(screen.getByTestId("ro-coverage-gateway")).toHaveTextContent("Response");
    expect(within(panel).getAllByRole("row").length).toBeGreaterThan(1);
    expect(screen.getByTestId("ro-lab-note")).toHaveTextContent(/reply this lab received from the Privilege gateway, not a log line/);
    expect(screen.getByTestId("ro-no-reply")).toHaveTextContent(/No reply came back to tools\/call \(no answer\)\. A call with no reply has no row/);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /api/info", "POST /api/gateway-check"]);
  });

  it("a record that could not be built is an alert, and an answer without a record shows no panel", async () => {
    mockApi({ "GET /api/info": { source: "mock", realAvailable: true }, "POST /api/gateway-check": { ...base, observability: { error: "bad_window", message: "The run record could not be built for this check." } } });
    const first = renderAs(<GatewayCheckCard />);
    expect(await screen.findByTestId("ro-error")).toHaveTextContent("could not be built");
    first.unmount();
    mockApi({ "GET /api/info": { source: "mock", realAvailable: true }, "POST /api/gateway-check": base });
    renderAs(<GatewayCheckCard />);
    await screen.findByTestId("gateway-trace");
    expect(screen.queryByTestId("run-observability")).toBeNull();
  });

  it("GatewayRunObs with a mock-sourced record is refused on screen, not shown under the real label", async () => {
    const m = await made("allow");
    render(<GatewayRunObs record={m.record} />);
    expect(screen.getByTestId("ro-mismatch")).toBeInTheDocument();
  });
});

describe("review fixes: titles, the retry, the backoff", () => {
  it("the two panels on one page have different names, and the lab's note reads as a note", async () => {
    const m = await made("allow");
    const log = createRunLog({ now: () => T });
    const { record } = await log.gatewayCheck({ startedAt: T, caller: "travel_agent", replies: [] });
    render(<><RunObs res={null} source="mock" /><GatewayRunObs record={record} /></>);
    const names = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(names).toEqual(["What each layer logged for this tool call", "What each layer logged for this gateway check"]);
    for (const note of screen.getAllByTestId("ro-lab-note")) { expect(note).toHaveClass("ro-lab-note"); expect(note).toHaveTextContent(/^Note\./); }
    expect(m.id).toBeTruthy();
  });

  it("the console's loading and alert states carry the console panel's name", async () => {
    mockApi({ "GET /api/run-observability": reply(400, { error: "bad_x", message: "nope" }) });
    render(<RunObs res={{ runId: "run-x-1" }} source="mock" />);
    expect(await screen.findByRole("region", { name: "What each layer logged for this tool call" })).toBeInTheDocument();
  });

  it("a retry of the gateway check clears the old record while the new one is on its way, then shows the new one", async () => {
    const log = createRunLog({ now: () => T });
    const one = await log.gatewayCheck({ startedAt: T, caller: "first_agent", replies: [] });
    const two = await log.gatewayCheck({ startedAt: T, caller: "second_agent", replies: [] });
    let release;
    const gate = new Promise((r) => { release = r; });
    let posts = 0;
    const base = { app: "travel-door", caller: "travel_agent", gateway: "https://gateway.example", listing: { ok: true, tools: [], ms: 1 } };
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      if (String(url) === "/api/info") return new Response(JSON.stringify({ source: "mock", realAvailable: true }), { status: 200 });
      posts += 1;
      if (posts === 2) await gate;
      return new Response(JSON.stringify({ ...base, observability: posts === 1 ? one.record : two.record }), { status: 200 });
    }));
    renderAs(<GatewayCheckCard />);
    await waitFor(() => expect(screen.getByTestId("run-observability")).toHaveAttribute("aria-label", expect.stringMatching(/gateway check/)));
    const firstRun = one.record.runId;
    expect(firstRun).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /run the gateway check/i }));
    expect(screen.queryByTestId("run-observability")).toBeNull(); // not the old record while the new check is in flight
    expect(screen.getByTestId("ro-loading")).toHaveTextContent("Collecting this run's logs…");
    release();
    await waitFor(() => expect(screen.getByTestId("run-observability")).toBeInTheDocument());
    expect(screen.queryByTestId("ro-loading")).toBeNull();
  });

  it("a failed poll does not stop the polling: the alert stays, the next try comes later each time, and the record appears when one works", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const m = await made("allow");
    let n = 0;
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      calls.push(String(url));
      n += 1;
      if (n < 3) throw new TypeError("offline");
      return new Response(JSON.stringify(answerOf(m)), { status: 200 });
    }));
    render(<RunObs res={{ runId: m.id }} source="mock" />);
    expect(await screen.findByTestId("ro-error")).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); }); // first retry after 3 s
    expect(calls).toHaveLength(2);
    expect(screen.getByTestId("ro-error")).toBeInTheDocument(); // the alert stays while it keeps failing
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); }); // the next wait is longer: 6 s
    expect(calls).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(calls).toHaveLength(3);
    expect(await screen.findByTestId("ro-table")).toBeInTheDocument();
    expect(screen.queryByTestId("ro-error")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(calls).toHaveLength(3); // a closed run is not asked for again
  });
});

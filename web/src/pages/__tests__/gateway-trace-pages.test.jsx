import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConsolePage from "../ConsolePage";
import GatewayCheckCard from "../../privilege-check/GatewayCheckCard";
import { PEOPLE, TOOLS, mockApi, renderAs } from "../../testUtils";
import { setJsonView } from "../../components/JsonPane";
// Traces are built by the server's own builders, so the page is tested against the shape the server really sends.
import { pepTrace, gatewayCheckExchanges } from "../../../../server/src/gatewayExchanges.js";
import { assertTrace } from "../../../../server/src/gatewayTrace.js";

afterEach(() => { vi.unstubAllGlobals(); setJsonView("form"); });

describe("Tool console: What Privilege did (mock, the lab's own PEP)", () => {
  const out = { outcome: "deny", rule: "default-deny", reason: "No policy permits this", rules: [], overridden: [], problems: [], app: "payments", trace_id: "t".repeat(32), traceparent: `00-${"t".repeat(32)}-${"s".repeat(16)}-01` };
  const sent = { tool: "pay_invoice", args: { invoiceId: "INV-1001", amount: 250 } };
  const reply = () => { const { traceparent, ...shown } = out; return { ...shown, exchanges: [{ step: 1, title: "Tool call: pay_invoice", status: 200, trace: pepTrace({ body: sent, out, sub: "mary", workspace: "default" }) }] }; };

  it("shows the panel under the decision after a call: request, response and checked decisions", async () => {
    mockApi({ "GET /api/tools": { tools: TOOLS }, "POST /api/tools/call": reply() });
    renderAs(<ConsolePage />, { me: PEOPLE.mary });
    expect(screen.queryByTestId("gateway-trace")).toBeNull();
    await waitFor(() => expect(screen.getByRole("option", { name: "pay_invoice" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Tool"), { target: { value: "pay_invoice" } });
    fireEvent.click(screen.getByRole("button", { name: "Call as Mary" }));
    const panel = await screen.findByTestId("gateway-trace");
    expect(within(panel).getByRole("heading", { name: "What Privilege did" })).toBeInTheDocument();
    expect(screen.getByTestId("gateway-trace-basis")).toHaveTextContent(/Simulated/);
    const decisions = screen.getByTestId("trace-1-decisions");
    expect(within(decisions).getByText("Policy (Cedar)").closest("li")).toHaveAttribute("data-outcome", "fail");
    expect(decisions).toHaveTextContent("default-deny");
    expect(screen.getByTestId("trace-1")).toHaveTextContent("refused at: Policy (Cedar)");
    expect(screen.getByTestId("trace-1-request-head")).toHaveTextContent("POST https://pep.privilege-demo.invalid/api/tools/call?envelope=1");
    expect(screen.getByTestId("trace-1-request-body").textContent).toContain("pay_invoice");
    expect(screen.getByTestId("trace-1-response-head")).toHaveTextContent("HTTP 200");
    expect(screen.getByTestId("trace-1-response-body").textContent).toContain("default-deny");
  });

  it("shows no panel when the console's own request failed (no exchanges)", async () => {
    mockApi({ "GET /api/tools": { tools: TOOLS } });
    renderAs(<ConsolePage />, { me: PEOPLE.mary });
    await waitFor(() => expect(screen.getByRole("option", { name: "pay_invoice" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Call as Mary" }));
    await screen.findByRole("region", { name: "PEP decision" });
    expect(screen.queryByTestId("gateway-trace")).toBeNull();
  });
});

describe("Privilege gateway card: What Privilege did (real)", () => {
  it("shows the real panel from the check's exchanges, marking decisions inferred or observed", async () => {
    const wire = (rpcMethod, status, body) => ({ http: "POST", url: "https://gateway.example/travel-door/mcp", rpcMethod, request: { headers: { Authorization: "Bearer <agent key, 12 characters, kept on the server>" }, body: { jsonrpc: "2.0", id: 1, method: rpcMethod, params: {} } }, response: { status, headers: { "content-type": "application/json" }, body }, at: "2026-01-01T00:00:00.000Z" });
    const listing = { ok: true, tools: [{ name: "search_flights" }], ms: 5, wire: [wire("initialize", 200, { result: {} }), wire("tools/list", 200, { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "search_flights" }] } })] };
    const exchanges = gatewayCheckExchanges(listing, undefined);
    exchanges.forEach((e) => expect(assertTrace(e.trace)).toEqual([]));
    const { wire: _w, ...shownListing } = listing;
    mockApi({ "GET /api/info": { source: "mock", realAvailable: true, realReason: null }, "POST /api/gateway-check": { app: "travel-door", caller: "travel_agent", gateway: "https://gateway.example", listing: shownListing, exchanges } });
    renderAs(<GatewayCheckCard />);
    const panel = await screen.findByTestId("gateway-trace");
    expect(screen.getByTestId("gateway-trace-basis")).toHaveTextContent(/Real gateway/);
    const decisions = within(panel).getByTestId("trace-1-decisions");
    expect(decisions).toHaveTextContent("inferred from the outcome");
    expect(decisions).not.toHaveTextContent(/checked/i);
    expect(screen.getByTestId("trace-1-request-head")).toHaveTextContent("kept on the server");
  });

  it("shows no panel when the gateway is not configured", async () => {
    mockApi({ "GET /api/info": { source: "mock", realAvailable: false, realReason: "Real needs the gateway settings" } });
    renderAs(<GatewayCheckCard />);
    await screen.findByText(/Real needs the gateway settings/);
    expect(screen.queryByTestId("gateway-trace")).toBeNull();
  });
});

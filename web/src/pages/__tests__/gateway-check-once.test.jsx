import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GatewayCheckCard from "../../privilege-check/GatewayCheckCard";
import { mockApi, renderAs } from "../../testUtils";
// The trace comes from the server's own builder, so the page is tested against the shape the server really sends.
import { gatewayCheckExchanges } from "../../../../server/src/gatewayExchanges.js";
import { assertTrace } from "../../../../server/src/gatewayTrace.js";

afterEach(() => { vi.unstubAllGlobals(); });

const wire = (rpcMethod, status, body) => ({ http: "POST", url: "https://gateway.example/travel-door/mcp", rpcMethod, request: { headers: { Authorization: "Bearer <agent key, 12 characters, kept on the server>" }, body: { jsonrpc: "2.0", id: 1, method: rpcMethod, params: {} } }, response: { status, headers: { "content-type": "application/json" }, body }, at: "2026-01-01T00:00:00.000Z" });
const listing = { ok: true, tools: [{ name: "search_flights" }], ms: 5, wire: [wire("initialize", 200, { result: {} }), wire("tools/list", 200, { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "search_flights" }] } })] };
const exchanges = gatewayCheckExchanges(listing, undefined);
const { wire: _w, ...shownListing } = listing;
const REAL = { "GET /api/info": { source: "mock", realAvailable: true, realReason: null }, "POST /api/gateway-check": { app: "travel-door", caller: "travel_agent", gateway: "https://gateway.example", listing: shownListing, exchanges } };
const checks = (calls) => calls.filter((c) => c.url.startsWith("/api/gateway-check"));

describe("Privilege gateway card in Real mode: the trace is drawn from the card's own result", () => {
  it("runs the gateway check exactly once in total and shows What Privilege did", async () => {
    exchanges.forEach((e) => expect(assertTrace(e.trace)).toEqual([]));
    const calls = mockApi(REAL);
    renderAs(<GatewayCheckCard />);
    const panel = await screen.findByTestId("gateway-trace");
    expect(within(panel).getByRole("heading", { name: "What Privilege did" })).toBeInTheDocument();
    expect(screen.getByTestId("gateway-trace-basis")).toHaveTextContent(/Real gateway/);
    expect(screen.getByTestId("trace-1-decisions")).not.toHaveTextContent(/checked/i);
    expect(screen.getByTestId("trace-1-request-head")).toHaveTextContent("kept on the server");
    // Let any late effect or second fetch show itself before counting.
    await new Promise((r) => setTimeout(r, 50));
    expect(checks(calls)).toHaveLength(1);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /api/info", "POST /api/gateway-check"]);
  });

  it("a retry is one more check and replaces the trace (two in total, never two per click)", async () => {
    const calls = mockApi(REAL);
    renderAs(<GatewayCheckCard />);
    await screen.findByTestId("gateway-trace");
    fireEvent.click(screen.getByRole("button", { name: /run the gateway check/i }));
    await waitFor(() => expect(checks(calls)).toHaveLength(2));
    await screen.findByTestId("gateway-trace");
    await new Promise((r) => setTimeout(r, 50));
    expect(checks(calls)).toHaveLength(2);
  });

  it("shows no panel and makes no gateway call when the gateway is not configured", async () => {
    const calls = mockApi({ "GET /api/info": { source: "mock", realAvailable: false, realReason: "Real needs the gateway settings" } });
    renderAs(<GatewayCheckCard />);
    await screen.findByText(/Real needs the gateway settings/);
    expect(screen.queryByTestId("gateway-trace")).toBeNull();
    expect(checks(calls)).toHaveLength(0);
  });

  it("shows no panel when the lab's check failed", async () => {
    mockApi({ "GET /api/info": { source: "mock", realAvailable: true }, "POST /api/gateway-check": { status: 502, body: { message: "gateway unreachable" }, __status: true } });
    renderAs(<GatewayCheckCard />);
    await screen.findByText(/gateway unreachable/);
    expect(screen.queryByTestId("gateway-trace")).toBeNull();
  });
});

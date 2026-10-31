// Test helpers: a fetch stub that answers by "METHOD /path" (query ignored), and a render with a fixed session.
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { SessionContext } from "./session";

export const PEOPLE = {
  mark: { sub: "mark", groups: ["travel-agents"], scope: "tools:invoke", isAdmin: false, source: "session", persona: "mark" },
  mary: { sub: "mary", groups: ["analysts"], scope: "tools:invoke", isAdmin: false, source: "session", persona: "mary" },
  priya: { sub: "priya", groups: ["travel-agents"], scope: "tools:invoke", isAdmin: false, source: "session", persona: "priya" },
  dana: { sub: "dana", groups: ["admins"], scope: "tools:invoke policy:admin", isAdmin: true, source: "session", persona: "dana" },
};

/** routes: { "GET /api/x": body | (reqBody, url) => body | { status, body } }. Returns the call log. */
export function mockApi(routes) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const path = String(url).split("?")[0];
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url: String(url), body });
    const h = routes[`${method} ${path}`];
    if (h === undefined) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    const out = typeof h === "function" ? h(body, String(url)) : h;
    const { status = 200, body: payload } = out && out.__status ? out : { status: 200, body: out };
    return new Response(JSON.stringify(payload ?? {}), { status });
  }));
  return calls;
}
export const reply = (status, body) => ({ __status: true, status, body });

export function renderAs(ui, { me = null, config = { idp: "local-mock", mockAvailable: true, bearer: false }, status } = {}) {
  const value = { status: status ?? (me ? "in" : "anon"), me, config, refresh: vi.fn(), signIn: vi.fn(async () => ({ ok: true })), signOut: vi.fn() };
  return { ...render(<SessionContext.Provider value={value}>{ui}</SessionContext.Provider>), session: value };
}

export const TOOLS = [
  { name: "search_flights", app: "search", description: "Search flights by route text.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, pinnedHash: "a".repeat(64), observedHash: "a".repeat(64), drifted: false },
  { name: "create_ticket", app: "ticketing", description: "Open a support ticket.", inputSchema: { type: "object", properties: { subject: { type: "string" } }, required: ["subject"] }, pinnedHash: "b".repeat(64), observedHash: "b".repeat(64), drifted: false },
  { name: "pay_invoice", app: "payments", description: "Pay an invoice.", inputSchema: { type: "object", properties: { invoiceId: { type: "string" }, amount: { type: "integer" } }, required: ["invoiceId", "amount"] }, pinnedHash: "c".repeat(64), observedHash: "c".repeat(64), drifted: false },
  { name: "book_fare", app: "booking", description: "Book a fare.", inputSchema: { type: "object", properties: { flightId: { type: "string" }, amount: { type: "integer" } }, required: ["flightId", "amount"] }, pinnedHash: "d".repeat(64), observedHash: "d".repeat(64), drifted: false },
];

// The claims the "Test a request" panel and the mapping table send to /api/decide-test. Same shape as a verified PingFederate
// access token (what the server's mapClaims reads). The groups are invented for the demo.
export const GROUPS = ["analysts", "finance", "travel-agents", "admins"];
export const TOOL_NAMES = ["search_flights", "create_ticket", "pay_invoice", "book_fare"];

export const TEST_USERS = [
  { id: "mark", label: "Mark", groups: ["travel-agents"], paymentsWrite: false },
  { id: "mary", label: "Mary", groups: ["analysts"], paymentsWrite: false },
  { id: "priya", label: "Priya", groups: ["travel-agents"], paymentsWrite: false },
  { id: "dana", label: "Dana", groups: ["admins"], paymentsWrite: false },
  { id: "finance", label: "Finance user (not a sign-in persona)", groups: ["finance"], paymentsWrite: true },
];

export const makeClaims = ({ sub, groups, paymentsWrite = false, dot = false, agent = "dot" }) => ({
  sub,
  groups,
  scope: paymentsWrite ? "tools:invoke payments:write" : "tools:invoke",
  client_id: "privilege-demo-web",
  ...(dot ? { act: { sub: agent } } : {}),
});

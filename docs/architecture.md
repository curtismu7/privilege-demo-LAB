# Architecture

One Node process (Express, ESM) serves the API, the mock MCP backend and the built web app. There is no database: policies and the audit log are files under `DATA_DIR`; approvals, sessions and the trace buffer are in memory. All of that state is per workspace (`X-Workspace`, default `default`). The app is in Mock mode (the default: an in-process mock issuer, no network) or Live mode (PingFederate's JWKS), and the header toggle switches it.

```
 AI agent / person
        |  Bearer <access token>: PingFederate (live) or the in-process mock issuer (mock), or a persona cookie (mock only)
        v
 +------------------------ privilege-demo server ------------------------+
 |  authenticate  ->  PEP enforce()  ->  Cedar decide()  ->  allow | deny | hold
 |  (pf.js)           (pep.js)           (cedar/decide.js)       |      |      |
 |                         |                                 run tool  403   approval record
 |                         +-- trace hop per step, audit.jsonl line     (202, approvers named)
 +----------------------------------------------------------------------+
        ^ two doors into the same enforce():  POST /mcp (Bearer only)   POST /api/tools/call (Bearer or persona)
```

## The pieces

| Piece | File | Job |
|---|---|---|
| Authentication | `server/src/auth/pf.js`, `server/src/mockIdp.js` | Verify the Bearer token with `jose` against the PingFederate JWKS (live) or the mock issuer's public key (mock): issuer, audience, `exp`/`nbf`, RS256 or ES256 only, clock skew capped at 60 s, `groups` required. Reasons are fixed codes; nothing from the token is echoed. |
| Mock sign-in | `server/src/auth/guards.js`, `personas.js` | Offline persona picker, Mock mode only. See [security.md](security.md). |
| Network guard | `server/src/netguard.js` | The only door out: nothing in Mock mode, only the configured PingFederate in Live mode. |
| Workspaces | `server/src/workspaces.js` | One policy store, approvals, drift, trace and audit per workspace id; reset clears one. |
| Settings | `server/src/settings.js` | The shared `~/Development/.env` loader (allowlisted keys only). |
| PEP | `server/src/pep.js` | `enforce()` is the only path to a tool. It checks arguments against the tool schema, calls Cedar, then runs the tool (allow), refuses (deny) or creates an approval (hold). |
| Cedar module | `server/src/cedar/` | Pure `decide()`; fails closed. See its [README](../server/src/cedar/README.md). |
| Policy store | `server/src/policyStore.js` | Active and Candidate policies as files; a set that does not validate is never installed. |
| Approvals | `server/src/approvals.js` | Held calls; approving re-evaluates with `approval_count` 1 and runs the tool at most once; unanswered holds expire after 10 minutes (deny). |
| Mock MCP backend | `server/src/mcp/backend.js` | `search_flights`, `create_ticket`, `pay_invoice`, `book_fare`, each with a schema hash. An admin switch makes a tool drift (story S05). |
| Trace and audit | `server/src/trace/`, `server/src/audit.js` | One trace-envelope event per hop; one `audit.jsonl` line per decision. |
| Preflight | `server/src/preflight.js` | `GET /api/preflight`: what is missing and the fix for each. |

## Claim mapping: PingFederate token to Cedar

Cedar never sees the JWT. `mapClaims()` (`server/src/cedar/mapClaims.js`) turns the verified claims into the request. Anything outside the table is dropped; a bad shape is a deny (`invalid-claims`).

| Token claim | Cedar | Notes |
|---|---|---|
| `sub` | principal `User::"<sub>"` | required, non-empty string up to 256 characters |
| `groups` (array of strings) | parents `Group::"<g>"` of the principal | up to 100, duplicates removed; the server refuses a token with no `groups` claim at all |
| `scope` (space-separated string) | `context.token.scopes` (a set) | e.g. `payments:write` |
| `client_id` | `context.token.client_id` | required |
| `act.sub` (object-valued `act`) | `context.token.actor`, and the action becomes `mcp:InvokeUnattended` | a string-valued `act` is rejected, not guessed at |

Not from the token: `context.app` (the tool's app), `context.args.amount` (the only argument Cedar sees), `context.pinnedHash` / `context.observedHash` (the S05 pin), `context.approval_count`. Free text, such as an approval justification, never reaches Cedar.

Whether a real PingFederate puts `groups` and an object-valued `act` in its access tokens is UNVERIFIED here (only a local stub issuer was used).

## Decision shape

`decide()` returns:

```
{ decision: "allow" | "deny",
  rule:      deciding policy id, or "default-deny", "invalid-claims", "invalid-request", "error",
  rules:     every forbid that fired,
  overridden: permits that would have allowed the call (so a forbid is shown beating a permit),
  reason:    the policy's @reason annotation,
  problems:  strings, when the input was rejected,
  trace:     { product, engine_version, hop, subject, actor, decision, latency_ms } }
```

The PEP turns it into one of three outcomes. A deny becomes **hold** only when every forbid that fired names `@approvers` and the same call would be allowed with `approval_count` 1; otherwise it stays **deny**.

| Outcome | HTTP (`/api/tools/call`) | JSON-RPC (`/mcp`) |
|---|---|---|
| allow | 200 with `result` | `result.content` |
| hold | 202 with `approvalId`, `approvers` | error `-32004`, `data.approvalId` |
| deny | 403 with `rule`, `reason` | error `-32003`, `data.rule` |

## The explanation object

`pep.enforce()` and the routes add an optional `explanation` (see `server/src/explain/`). It is built after the outcome is known, inside a guard: if building fails the decision is unchanged and the explanation is `{ v: 1, error: true, ... }`.

```
{ v: 1, outcome, kind: allowed | default-deny | blocked | held | hold-no-way-through | before-rules | approval-denied | approval-expired,
  headline, why,
  who:   { name, groups, scopes, agent, via, text },
  asked: { tool, app, attended, attendedText, details, approvalsSoFar, schemaChanged, text },
  decidedBy: { id, kind: allow | block | hold | default, reason, does } | null,
  rules: [ { id, kind, reason, status, statusText, because: [string], deciding, oneLine, explainedFrom: structure | text } ],
  change: { text, items, complete } | null,   approval: { approvers, where, approvalWouldAllow, text } | null,
  before: { code, problems } | null,          notes: [string],
  checks: { agreed, rules, clauses },         technical: { rule, reason, rules, overridden, engine } }
```

How it is made: each active policy is taken apart (`cedar.policyToJson`) into permit-only pieces: the whole policy, each scope part, and each `when` / `unless` condition (a top-level `&&` is split into its conjuncts). One more `isAuthorized` call over those pieces, with the same schema, entities and context `decide()` builds, returns in `diagnostics.reason` every piece that holds and in `diagnostics.errors` every piece that errored. That says, for each rule, whether it applied and which part did not hold. The sentences come from fixed templates over the clause shapes in `clauses.js`; real values (the amount, the group, the scope) come from the request. The reading is then compared with `decide()`'s `decision`, `rules` and `overridden`; any difference sets `checks.agreed = false`, drops every `because`, and adds a note. The per-policy work is cached per policy set, which is a new object on every edit, so an edit changes the next explanation. Only active policies are explained (a Candidate stays in the shadow diff). Above 400 pieces the explanation degrades to whole rules.

`explanation.outcome` is the PEP's final outcome. `POST /api/decide-test` still returns its own `outcome` (a hold even where the console would deny because no allow rule remains after an approval); with `explain: true` the explanation says which the console would answer.

## Trace

Each request gets a W3C `traceparent` (an incoming valid one is continued). Hops, in order: `auth` (token verified or refused), `policy:ai-policy` (Cedar, with latency), `tool` (only when it ran), `pep` (the final outcome), and `approval` when a person answers. `GET /api/trace` returns them newest first, plus `explanations` (the plain-English why of the `pep` and `approval` hops, keyed by `span_id`; the events themselves have no such field); the Trace page shows them. An explanation carries amounts, groups and scopes, so it is returned only to the requester, a named approver and an admin, the same people `GET /api/approvals` shows the call to. Events pass through a credential filter, so a token-shaped value is never stored.

## Web

React + Vite, no router (the page is picked by path). Pages: Sign in, AI Policies, Tool console, Approvals, Trace, Learn (stories S01, S04, S05, S23, S35), Diagram (ReactFlow with movable boxes, Simulate, Reset and a speed control). The layout of `web/src/data` and `web/src/story` follows the kit conventions so the shared base can adopt it later.

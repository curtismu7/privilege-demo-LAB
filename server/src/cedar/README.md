# AI Policies decision module (server/src/cedar)

The decision module for the Privilege demo's own **AI Policies** engine (Cedar lane B). It answers one question: given verified PingFederate token claims and an MCP tool call, does the policy set allow it, and which policy decided?

It runs the open-source Cedar engine (`@cedar-policy/cedar-wasm`, pinned to exactly 4.14.0) in-process on the server. No network, no HTTP, no UI.

## How a decision is made

1. `init()` once loads the wasm engine and `schema.cedarschema`.
2. `validatePolicies({ id: cedarText })` checks policy text strictly against the schema, with limits (50 policies, 4 KB each, 64 KB total, nesting 32). It returns `{ ok, problems, policySet }` and never throws. Templates are rejected.
3. `decide({ policySet, claims, toolCall })` is pure and synchronous:
   - `mapClaims` turns the verified claims into Cedar input: `sub` becomes `User::"<sub>"`, `groups` become `Group` parents (capped at 100), `scope` becomes `context.token.scopes`, `client_id` and `act.sub` go in `context.token`. Claims that are not plain JSON are rejected.
   - Cedar evaluates. Default is deny; any matching `forbid` beats any `permit`.
   - The result: `decision` (`allow`/`deny`), `rule` (first id in Cedar's reason list, or `default-deny`), `rules[]`, `overridden[]` (permits that said yes but lost to a forbid, found by re-running with forbids removed), `reason` (the policy's `@reason` text), and `trace`.
   - `trace` carries the fields for a trace-envelope hop: `product: 'cedar'`, `hop`, `subject`, `actor`, `decision { result, rule, reason }`, `latency_ms`. The caller adds trace ids and timestamps; no trace library is imported.
   - `toolCall.pinnedHash` (the hash approved for the tool) is **required**: a missing, empty or non-string value is a `deny` with rule `invalid-request`. There is no default, so a caller that forgets it cannot switch off the S05 rug-pull check. `observedHash` is the hash seen now. `args` must be plain JSON.
   - Bad claims or a request that does not fit the schema fail closed: `deny` with rule `invalid-claims` or `invalid-request`. `decide()` never throws: any input it cannot read (no argument, strings, throwing getters or Proxies, cyclic or huge objects) returns `deny` with rule `error` and a fixed reason that echoes nothing from the input.

The vocabulary is a subset of the real Privilege console's (`Action::"mcp:Invoke"` / `"mcp:InvokeUnattended"`, `Tool`, `context.app`, `context.args`, `context.token.scopes`, `approval_count`), so policy text can later be pasted across. `pinnedHash`, `observedHash`, `token.client_id` and `token.actor` are demo extensions the real console does not have.

## Shipped policies (`policies/*.cedar`)

Six policies for stories S04, S05, S01 and S23. The groups `analysts`, `finance` and `travel-agents` are **invented**; they are not real PingFederate or Privilege groups.

## What is real

- Cedar 4.14.0 evaluation and strict schema validation, the claim mapper, default deny, forbid-beats-permit with the overridden-permit report, the trace hook fields.
- Tests include fixed-number checks of every documented limit (`server/test/cedar/limits.test.js`), fail-closed checks (`server/test/cedar/failclosed.test.js`) and a table-driven `group to tool mapping` test (`server/test/cedar/mapping.test.js`) that only covers cells the six shipped policies decide (no admins policy; ticketing for finance is default-deny because nothing permits it).
- Tests (`npm test`, vitest) run with a guard that throws on any socket, DNS or fetch, so passing means no network was used.

## What is NOT built

- No HTTP server, PEP, UI, editor or ReactFlow diagram.
- No PingFederate calls and no JWT verification. Callers pass already verified claims. Whether PF puts `groups` and an object-valued `act` into the evaluated token is UNVERIFIED.
- No hold outcome. `@approvers` is read from policy annotations but a forbid on `mcp:InvokeUnattended` is only reported as `deny`; turning it into a hold is the PEP's job. The real gateway's ordering is UNVERIFIED.
- No Active/Candidate state, no policy storage, no lane A (publishing to the real console), no PingOne Authorize comparison.
- `args` is typed as `{ amount?: Long }` only; a fuller per-tool schema is future work.
- Truncated group lists are flagged (`truncated`) by `mapClaims` but `decide` does not surface it.

## Use

```js
import { init, loadShippedPolicies, validatePolicies, decide } from './src/index.js';
init();
const { policySet } = validatePolicies(loadShippedPolicies());
decide({ policySet, claims, toolCall: { tool: 'book_fare', app: 'booking', args: { amount: 900 }, pinnedHash: 'h1', observedHash: 'h1' } });
```

## Licence

Repository code: UNLICENSED (private). Cedar and `@cedar-policy/cedar-wasm` are Apache-2.0; verified from the installed package's `package.json` (`"license": "Apache-2.0"`) and `npm view`. The package ships no separate LICENSE/NOTICE file in its tarball listing (checked), so keep the Apache-2.0 attribution if redistributing. Transitive dependency licences were not reviewed.

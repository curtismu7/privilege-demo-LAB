# Privilege demo LAB

A small standalone SE demo of a Privilege-style policy enforcement point (PEP). An AI agent's MCP tool calls are checked against [Cedar](https://www.cedarpolicy.com/) policies and each one is allowed, denied, or held for a person to approve. Decisions use the claims of a PingFederate access token.

Personas: Mark (traveler), Mary (analyst), Priya (approver, travel-agents lead), Dana (admin). Groups: `analysts`, `finance`, `travel-agents`, `admins`. Tools: `search_flights`, `create_ticket`, `pay_invoice`, `book_fare`. The groups are invented for the demo.

**Catalog:** D1 "PingOne Privilege (AI gateway)", with Cedar as its AI Policies engine (lane B of the Cedar research). One of the family of small standalone SE demo repos.
**Status:** v0.3.0, runs locally. Not on GitHub yet (no remote), CI has never run, and the shared demo-kit base is not built (this app is self-contained and laid out so it can adopt the base later).

## Quickstart (host-run, offline)

```sh
cp .env.example .env     # needed: it turns the mock sign-in on (ALLOW_MOCK_SIGNIN=1)
npm install
npm run doctor           # Node, DATA_DIR, port, Cedar + policies (names the fix for anything wrong)
npm run build
npm start                # http://localhost:8080  (set PORT in .env if 8080 is taken)
```

Open the page, pick a persona (no password, no network), then use **Tool console**, **AI Policies**, **Approvals**, **Learn** and **Diagram**. Dana (admin) is hidden until you create the switch file: `touch .data/ALLOW_ADMIN_PERSONA`.

Dev with hot reload: `npm run dev` runs the API on `PORT` (default 8080) and Vite on `VITE_PORT` (default 5173, `/api` is proxied), for example `PORT=8090 VITE_PORT=8091 npm run dev` and open the Vite port (give `PORT` in the shell here: the Vite proxy does not read `.env`).

`npm test` runs the server suites (Cedar behind a no-network guard, plus app tests) and the web suites.

## Utility / NERC CIP-style pack (optional)

`PACK=utility npm start` runs a second vertical beside the original: tools `github.read_pr`, `github.post_review_comment`, `kb.search`, `cloudwatch.query_logs`, `backlog.create_story_draft` (allow), `backlog.update_story`, `confluence.update_requirement` (hold for Priya), `github.merge_pr`, `github.approve_pr`, `policy.change` and every `deploy.*` (deny, no approval overrides). Groups `engineers`, `governance-reviewers`, `business-analysts`, `compliance` are **invented** and every backend is a **mock**; the page says so on every screen. Policies read a `repo` and a data `classification` on the target; each decision names the user, the agent and the tool. The default (`PACK` unset) is the original demo, unchanged. See [docs/utility-pack.md](docs/utility-pack.md), the utility section of [docs/group-to-tool-mapping.md](docs/group-to-tool-mapping.md), and `npm run e2e:utility`.

## Run in Docker (OrbStack)

```sh
HOST_PORT=18080 docker compose up --build -d     # http://localhost:18080
```

Two containers start:

- `privilege-demo`: the app in PF mode (`NODE_ENV=production`, `IDP=pf`, non-root). It never offers the mock sign-in, so the web page shows Bearer-token guidance instead of a persona picker; callers use `Authorization: Bearer <token>`.
- `stub-issuer`: **local demonstration only, not PingFederate.** It generates a key pair at start, serves a JWKS and mints test tokens. It sits on the same compose network as the app (the app reaches it at `http://stub-issuer:9031`; `PF_HTTP_HOSTS=stub-issuer` is the only host allowed over plain http besides loopback) and publishes no port. Restarting either container on its own is safe.

Mint a token for a persona and call the MCP door:

```sh
TOKEN=$(docker compose exec -T stub-issuer node stub-issuer/mint.mjs priya)
curl -s localhost:18080/mcp -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"book_fare","arguments":{"flightId":"FL200","amount":500}}}'
```

Options for `mint.mjs`: `--act dot` (Dot acts for the persona, so the call is unattended), `--groups finance`, `--scope "tools:invoke payments:write"`.

Check a running stack by content (health, web page, valid and tampered tokens, one decision per group and tool cell, the approval path):

```sh
BASE_URL=http://localhost:18080 npm run smoke
```

### Point it at a real PingFederate

Put these in `.env` (copy `.env.example`), then start only the app so the stub is not used:

```sh
PF_URL=https://your-pingfederate.example.com     # base URL; must be https (http only for loopback)
PF_AUDIENCE=the-audience-pf-puts-in-tokens        # checked against the token's aud
# PF_ISSUER=   defaults to PF_URL        PF_JWKS_URL=   defaults to PF_URL/pf/JWKS
docker compose up --build -d privilege-demo
```

Tokens must be RS256 or ES256 and carry `sub`, `groups` (array), `client_id`; `scope` and an object-valued `act` are optional. Whether your PingFederate emits `groups` and an object-valued `act` is something to confirm there; this demo has only been run against the stub. `GET /api/preflight` (and the Sign in page) list what is missing and the fix.

## Browser run of the stories

```sh
npx playwright install chromium    # once (or have Google Chrome installed: the script falls back to it)
npm run build && npm run e2e       # starts its own server on a free port, offline
```

`scripts/e2e.mjs` drives the host-run app through S04 (Mary: two of three tools), S01 (two browser contexts: Mark's agent is held, Priya approves), S23 (the hard cap beats the permit) and S05 (Dana makes a tool drift), checks each result card, and saves screenshots to `e2e-output/`. It is run by hand; it is not part of `npm test` or CI.

## What is here

- `server/src/cedar/`: the Cedar decision module (six policies, claim mapper, fail-closed `decide()`); see its [README](server/src/cedar/README.md).
- Sign-in: Bearer PF token verified against the JWKS (live path), or the host-run persona picker with hard guards. See [docs/security.md](docs/security.md).
- A mock MCP backend, the PEP, approvals (hold, approve, deny, expiry), a policy store with Active and Candidate policies, trace and audit.
- Web: Sign in, AI Policies (list, editor with server-side Validate, Test a request with Candidate shadow diff, group-to-tool table), Tool console, Approvals, Trace, Learn (S01, S04, S05, S23, S35 with Allowed/Blocked switch and generic, airlines, banking packs), Diagram (ReactFlow: movable boxes, Simulate, Reset, speed).
- Preflight: `npm run doctor`, `GET /api/preflight`, a setup card on the Sign in page, and startup refusals that name the setting.

Docs: [architecture and claim mapping](docs/architecture.md), [group-to-tool mapping](docs/group-to-tool-mapping.md), [how to add a policy](docs/add-a-policy.md), [security notes](docs/security.md). Changes: [CHANGELOG](CHANGELOG.md).

## Not verified / known limits

- Whether a real PingFederate puts `groups` and an object-valued `act` in access tokens: UNVERIFIED. A token with no `groups` claim is refused.
- Single tenant, one process, not for hosted use. Approvals, sessions and the trace buffer are in memory and lost on restart; policies and `audit.jsonl` are files under `DATA_DIR`.
- No demo persona is in `finance`, so `pay_invoice` is reachable only with a token that has that group (`mint.mjs --groups finance`), or through Test a request.
- The e2e script and the container checks were run on one macOS machine (OrbStack); CI has not run.

## Layout

- `server/`: Express (ESM). `src/app.js` exports `createApp()`; `src/cedar/` is the decision module.
- `web/`: React + Vite; the page is picked by path in `src/main.jsx` (no router).
- `stub-issuer/`: the local demonstration issuer and its `mint.mjs` CLI.
- `scripts/`: `doctor.mjs`, `smoke.mjs`, `e2e.mjs`. `.githooks/pre-commit` (gitleaks), `.github/workflows/ci.yml` (`RUNS_ON` repo variable, default `["self-hosted","macOS"]`).

## Licence

Private and unlicensed (see LICENSE). Cedar and `@cedar-policy/cedar-wasm` are Apache-2.0.

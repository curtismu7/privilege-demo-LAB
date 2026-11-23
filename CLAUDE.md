# privilege-demo-LAB

Tier: Demo. An AI agent's MCP tool calls pass a policy enforcement point (PEP) that decides allow, deny or hold with Cedar. Mock mode
(default) runs everything in process; live mode verifies Bearer tokens from your own PingFederate.
Rules: STANDALONE-RULES-FOR-AGENTS.md and STANDALONE-CSS-STANDARD.md in ~/Development (use the standalone-demo skill).
Ports: app 4510 (`PORT`), dev server and tests 4760-4769 only.

## Mock and live

Mock / Live toggle in the header of every page (`PUT /api/mode`), the banner shows the same mode. Start mode is `DEMO_MODE` (or `MODE` when
it says mock or live; shared-file key `PRIVILEGE_DEMO_MODE`), default mock.
- Mock: the in-process mock issuer (`server/src/mockIdp.js`, P-256 via createECDH) signs tokens labelled mock; `POST /api/mock/token` hands one to
  the signed-in persona; `/mcp` accepts only mock tokens. Persona sign-in needs `ALLOW_MOCK_SIGNIN=1` (`npm start` sets it on a loopback
  bind, compose sets it with `LAB_PUBLISH=loopback`), is refused behind a proxy, on a non-loopback bind and in live mode.
  `NODE_ENV=production` is not a guard: the Docker image sets it.
- Live: Bearer tokens verified against PingFederate's JWKS (`PF_URL`, `PF_AUDIENCE`). Only that origin is reachable.
- `server/src/netguard.js` is the only door out: mock mode opens no socket (self-test at start, in `npm run doctor`, and a mutation-proof
  test); live mode reaches only the configured PingFederate. Nothing else may call `fetch`.

## Run and test

- `npm install`, `npm run build`, `npm start` (127.0.0.1:4510), `npm run doctor`, `npm run reset [workspace]`.
- `npm test`: server (`vitest run`, Cedar wasm, slow on first import: 30 s test timeout), then web (vitest, jsdom).
  The server tests are vitest suites under `server/test/app` and `server/test/cedar` (cedar runs behind a no-network guard).
- `npm run check:diagrams` (label overlap, every diagram, three widths), `npm run e2e` and `npm run e2e:utility` drive the real UI in Chromium (ports 4760-4769, throwaway DATA_DIR). `npm run smoke` checks a
  running live-mode app against the local stub issuer.
- Docker: `docker compose up --build -d` -> http://127.0.0.1:4510 (mock). Live: set `PF_URL`, `PF_AUDIENCE`, `DEMO_MODE=live`.
- Node 26 (owner decision 2026-10-31): Dockerfile, CI, `engines` (>=26) and the doctor check all say 26; no older Node version is supported.

## Rules that bite

- Settings: one shared file, `~/Development/.env` (or `STANDALONE_ENV`), only the keys in `server/src/settings.js` are read; admin and worker
  credentials are never read (they live only in `~/.config/demo-kit/provisioning.json`).
- Workspaces (rule 13): `X-Workspace` header, default `default`; per-workspace store, approvals, drift, trace, audit, sign-in cookie. The default
  workspace keeps the original `DATA_DIR` layout, others live in `DATA_DIR/workspaces/<id>`. Reset clears one workspace.
- Loopback bind (0.0.0.0 only inside Docker, published on 127.0.0.1), Host check (`LAB_ALLOWED_HOSTS` adds names), same-origin JSON-only writes.
- Explanations live in `server/src/explain/` (derived permit-only pieces, one extra Cedar call, checked against `decide()`; text built from templates, never per scenario). They are additive hooks in `pep.js`, `approvals.js` and `app.js`; never edit `cedar/decide.js`. Shapes that tests pin and must not grow: `/mcp` error `data`, trace events, the generic public pack `{id,label}`, `POST /api/policies/validate`, decide-test `outcome`. Golden files: `UPDATE_GOLDEN=1` in `server/test/cedar`.
- Cedar is the decision point. `decide()` fails closed; free text (justification) never reaches it; arguments are validated before Cedar.
- Stories use `{{cast}}` tokens (`web/src/data`); `customer.config.json` (gitignored; `customer.config.example.json`) renames people and nouns.
  A test fails on any undefined token (`scripts/story-tokens.mjs`).
- Diagrams are diagram-studio/1 JSON in `web/src/diagrams/`, loaded by name; never build nodes or edges in JSX. Check label overlap with
  `~/Development/AI-DEMO-Standalone/scripts/diagram-overlap.js` in a headless browser after changing one.
- CSS: `web/src/standalone-ui.css` is vendored from `~/Development/AI-DEMO-Standalone/shared/` (never edit; `scripts/check-ui-standard.sh`); app CSS
  uses tokens only (`scripts/check-css.sh` in AI-DEMO-Standalone). Fonts are bundled (the page loads nothing from outside).
- No identifiers from other projects; tests use only `*.example` / `*.invalid` hosts. History scan must print 0.
- EC keys via createECDH + createPrivateKey, never generateKeyPairSync('ec'). Tests use a glob, never a directory.
- Live verification against a real PingFederate is owner-run. `scripts/pingfederate-setup.sh` is the family's installer (vendored, never edit).
- Run observability (Rule 27): `server/src/runObservability.js` and `web/src/run-observability/` (with `scripts/run-observability-checkPin.mjs`) are vendored byte for byte from AI-DEMO-Standalone `shared/run-observability` and pinned by `run-observability.sha256` (a test calls `checkPin`); never edit them. This lab reads no logs, so it vendors the core only: no readers file, no `RUN_OBS_*` setting, no Docker socket (a test pins that, comments included). `server/src/runLog.js` is this lab's half: each decision is stamped once, written as one stdout line and kept as a fact of its run; the record is built from those stored facts only (Mock: `simulated` rows; Live: a real record with every layer `not-logged`, because the lab's own decisions are neither a log nor a product reply; the Real gateway check: `response` rows, a call with no reply has no row). A run is one tool call and a held call keeps it open; its mode is stored on it and the route (`GET /api/run-observability[?runId=]`) returns it only in that mode. The stdout line uses none of the words the shared matchers read (a test runs every line through `classify()`, causes included); a throwing recorder never changes an answer or the audit. A held run is read whole only by its participants (the same people as `/api/approvals`); anyone else gets it without the people. The runs cap is per mode. `GatewayCheckCard.jsx` clears the old record and trace when its retry button is pressed (the vendored card reports only a finished check); the console's `RunObs` is keyed by run id and mode, so it never shows another run's record while one loads. The page side is `web/src/components/RunObs.jsx` and the record mounted in `GatewayCheckCard.jsx`.
- "What Privilege did" (Rule 25): `web/src/gateway-trace/` and `server/src/gatewayTrace.js` are vendored byte for byte from AI-DEMO-Standalone `shared/gateway-trace` and pinned by `gateway-trace.sha256` (`web/src/__tests__/gateway-trace.pin.test.js`); never edit them. `server/src/gatewayExchanges.js` is this lab's builder: `pepTrace` turns a console call's outcome into a mock trace (the PEP computed each decision, so `checked`; `POST /api/tools/call?envelope=1` adds it as `exchanges`, the plain call is unchanged) and `gatewayCheckExchanges` builds the real trace of `POST /api/gateway-check` from the shared hop's capture (`createRealDoor({ capture: true })`, `gatewayReal.js` re-vendored with it; real decisions are inferred or observed only). The panel is mounted under the console result and, for the gateway check, by `web/src/privilege-check/GatewayCheckCard.jsx` (this lab's component: the vendored `PrivilegeCheck` card, byte for byte from `shared/privilege-check` and pinned by `web/src/__tests__/privilege-check.pin.test.js`, plus the panel drawn from the card's own `onResult` answer, so there is one gateway call, never a second one). Never edit the vendored card. Tests call `assertTrace` on both and check that no key or cookie value is in a trace. Not traced: `/mcp`, approve/deny, `decide-test`.

# Privilege demo LAB

A standalone demo of a Privilege-style policy enforcement point (PEP): an AI agent's MCP tool calls are checked against [Cedar](https://www.cedarpolicy.com/) policies, and each one is allowed, denied, or held for a person to approve.

Tier: Demo
Repo: https://github.com/curtismu7/privilege-demo-LAB
Catalog: D1 "PingOne Privilege (AI gateway)", with Cedar as its AI Policies engine.

Personas: Mark (traveler), Mary (analyst), Priya (approver, travel-agents lead), Dana (admin). Groups: `analysts`, `finance`, `travel-agents`, `admins`. Tools: `search_flights`, `create_ticket`, `pay_invoice`, `book_fare`. The people and groups are invented for the demo. Rename them with `customer.config.json` (see below).

## What is simulated

- **Mock mode** (the default): everything runs in the app, offline. The sign-in is a persona picker with no password; the access tokens are signed by an in-process **mock issuer** (not PingFederate) and are shown whole and labelled mock; every tool backend returns made-up results. A network guard opens no socket, so nothing leaves the machine. The Cedar decisions, the approvals and the trace are real.
- **Live mode** (owner-run): `Authorization: Bearer` access tokens are verified against the JWKS of the PingFederate you name (`PF_URL`, `PF_AUDIENCE`), and only that origin is contacted (https, no redirects, time cap). Tool backends are still mocks. Not verified against a real PingFederate: whether it puts a `groups` array and an object-valued `act` in access tokens. That is UNVERIFIED and has to be confirmed there; a token with no `groups` claim is refused.
- The banner under the header says which mode is on, on every page and in presenter mode. A vertical pack (`PACK=utility`) adds a standing notice that its groups are invented and its backends are mocks.

## Run from a clone

Prerequisites: Node 26 or newer, git. Docker only for the Docker form.

```sh
git clone https://github.com/curtismu7/privilege-demo-LAB.git
cd privilege-demo-LAB
npm install
npm run build
npm start
```

Open http://127.0.0.1:4510. With no settings at all it starts in mock mode and everything works: pick a persona, then use **Tool console**, **AI Policies**, **Approvals**, **Trace**, **Learn** and **Diagram**. Dana (admin) is hidden until you create the switch file: `touch .data/ALLOW_ADMIN_PERSONA`.

`npm start` allows the mock sign-in (`ALLOW_MOCK_SIGNIN=1`) because it listens on 127.0.0.1 only. The talk track for a live presentation is [docs/talk-track.md](docs/talk-track.md). Dev with hot reload: `npm run dev` runs the API on `PORT` and Vite on `VITE_PORT` (default 4761, `/api` is proxied); open the Vite port.

## Settings file

The app reads one settings file, `~/Development/.env` (keep it mode 600), or the file named by `STANDALONE_ENV`. Real environment variables win over it. Only the keys below are read; any other line is dropped unread, and an admin or worker credential in the file is ignored and named in a warning. **Mock mode needs none of them.**

| Key | What it does |
| --- | --- |
| `PRIVILEGE_DEMO_MODE` | `mock` (default) or `live`. As an environment variable it is `DEMO_MODE`. The header toggle changes it at run time. Optional. |
| `PF_URL` | Live mode: base URL of your PingFederate (https; http only for loopback). |
| `PF_AUDIENCE` | Live mode: the audience your PingFederate puts in access tokens for this app. |
| `PF_ISSUER`, `PF_JWKS_URL`, `PF_HTTP_HOSTS`, `CLOCK_SKEW_SEC` | Optional live-mode details (issuer defaults to `PF_URL`, JWKS to `PF_URL/pf/JWKS`, skew is capped at 60 s). |
| `PACK` | `generic` (default) or `utility` (a utility-style vertical with invented groups and mock backends). Optional. |
| `DATA_DIR`, `APPROVAL_TTL_MS`, `SESSION_SECRET`, `SESSION_TTL_MS` | Optional: where policies and the audit log live, how long a held call waits, the cookie signing secret. |

Not in the shared file, set in the environment: `PORT`, `HOST`, `ALLOW_MOCK_SIGNIN`, `LAB_PUBLISH`, `LAB_ALLOWED_HOSTS` (extra host names the app answers to), `CUSTOMER_CONFIG`. See [.env.example](.env.example).

**customer.config.json** (optional, gitignored; start from `customer.config.example.json`) sets a name, a tagline, the default vertical, and renames the people (`cast`) and nouns (`vocabulary`). The story text keeps its `{{cast}}` tokens, so it changes with the file. No real customer name belongs in the repo.

## Ports, and what to do if the port is taken

Ports: privilege-demo-LAB listens on 4510 (set with PORT, default 4510).
Port range for this app: 4510 (the app) and 4760-4769 (the Vite dev server, VITE_PORT default 4761, and the tests).

If the port is taken:
1. Find what is using it:
   lsof -iTCP:4510 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, stop it, or start this app on another port:
   PORT=4762 npm start
4. Do not use 8080, 5173, 3000, 4000, 4400, 4600-4601, 18080, 19080 or 19090.
   Those are taken by other demos or other tools.

Docker host port: `HOST_PORT` (default 4510), always published on 127.0.0.1.

## Mock and live modes

The **Mock / Live** toggle is in the header on every page, presenter mode included, and shows the current mode. The banner shows the same mode.

- Switching to Live needs `PF_URL` and `PF_AUDIENCE`; without them the toggle says so and stays on Mock. In Live mode there is no persona picker: callers send `Authorization: Bearer <access token>` to `POST /mcp` or the `/api` routes.
- In Mock mode the Tool console has **Get a mock token**: a token for the signed-in person (optionally with `act` set to the agent), signed by the mock issuer, to try `POST /mcp` from a terminal. `/mcp` accepts only mock tokens in Mock mode and only PingFederate tokens in Live mode.
- Mock sign-in (rule 11) needs `ALLOW_MOCK_SIGNIN=1`, a loopback bind (or `LAB_PUBLISH=loopback`, which the Docker form sets because its port is published on 127.0.0.1 only), no proxy headers (except behind the lab-proxy, where the Host is a `LAB_ALLOWED_HOSTS` name), and a loopback or `LAB_ALLOWED_HOSTS` Host. `NODE_ENV=production` is not a guard: the Docker image sets it.
- `GET /api/health` reports `runtime: offline` in Mock mode and `live` in Live mode.

Workspaces (rule 13): the header names the current workspace (default `default`). Each workspace has its own policies, approvals, drift state, trace, audit log and sign-in; the API takes it as the `X-Workspace` header. Reset clears only the current workspace.

**Presenter mode** (the Presenter button, or `?presenter=1`; Esc leaves): the nav steps back, the text grows, the talk track opens on each page, and the mode toggle and banner stay.

## Health, doctor and reset

```sh
npm run doctor            # one line per check; exit 1 on failure
npm run reset [workspace] # clears one workspace on the running app; sign-ins and settings stay
```

- `GET /api/health` returns `demo-health/1` (public, GET only, no detail): `state` (`ready`, `needs-setup`, `broken`), `runtime` (`offline` or `live`) and the demo id, name and version.
- `npm run doctor` checks Node 26, the shared settings file, the configuration, that Cedar loads and every shipped policy validates, the network guard's self-test with zero outbound attempts in mock mode, the health route, a real allow and a real deny, the port, the diagrams, the `{{cast}}` story tokens and the content pack. With `DEMO_MODE=live` it also checks the PingFederate JWKS through the same guard.
- `npm run reset [workspace]` (default workspace `default`, or set `WORKSPACE`) restores that workspace's shipped policies and clears its approvals, tool drift and trace. The same reset is `POST /api/workspaces/<id>/reset` from this machine, and `POST /api/reset` for the admin in the page.
- `scripts/pingfederate-setup.sh` is the family's installer for a local PingFederate (owner-run, needs a licence file the owner hands out; nothing licensed is in this repo).

## Docker (optional)

```sh
docker compose up --build -d      # mock mode, nothing to set up
```

Open http://127.0.0.1:4510. The port is published on 127.0.0.1 only (a test pins that), the container runs as a non-root user with a read-only filesystem, and policies live in a named volume.

For live mode set `PF_URL`, `PF_AUDIENCE` and `DEMO_MODE=live` in your shell or a local `.env` next to `docker-compose.yml`. To exercise the live path with no PingFederate, add the local stub issuer (not PingFederate; it mints test tokens and publishes no port):

```sh
PF_URL=http://stub-issuer:9031 PF_HTTP_HOSTS=stub-issuer PF_AUDIENCE=privilege-demo docker compose --profile stub up --build -d
TOKEN=$(docker compose --profile stub exec -T stub-issuer node stub-issuer/mint.mjs priya)
BASE_URL=http://127.0.0.1:4510 npm run smoke     # checks live mode by content
```

To point it at a real PingFederate, put its base URL in `PF_URL` (https) and the audience it issues in `PF_AUDIENCE`; tokens must be RS256 or ES256 and carry `sub`, `groups` (array) and `client_id`; `scope` and an object-valued `act` are optional. `GET /api/preflight` lists what is missing.

## Understanding a decision

Every tool call, held call and "Test a request" answer comes with a plain-English card, so nobody has to read Cedar.

- **The card** (Tool console, Test a request, Approvals, and "Why this decision" on the Trace page): *Who asked* (the person from the token, their groups, the agent acting for them), *What was asked* (tool, app, the amount, attended or unattended), *Why* (one sentence naming the deciding rule and what it requires), *What would change the answer* (only when it can be worked out; each line is checked by running the request again with that one change), *Approval* (who must approve, and where), and *Rules checked*: every active rule marked *Allowed it*, *Blocked it*, *Held it for approval*, *Did not apply* (with the real reason) or *Not about this tool*. The raw facts are under *Technical details*.
- **The rules**: on **AI Policies** each rule says what it does, who it covers, which tools, its conditions, whether it allows, blocks or holds, and how rules combine (a block rule always beats an allow rule; if nothing allows a call it is denied). Examples are computed by asking the real rules; they are not typed. A rule the page cannot put into words says "Explained from its text". While an admin edits, the meaning of the unsaved text is previewed.
- **Try this**: on the Tool console, buttons fill in the form (they never call) for the cases the shipped rules are built around, with what to expect next to each. Every expectation is tested against the real outcome. The expectations are written for the mock people, so the card is shown in Mock mode only; a button written for someone else is dimmed and disabled, and says whose result it shows.
- **API**: `explanation` on `POST /api/tools/call` (also `?envelope=1`), approvals (`explanation`, `outcome.explanation`), `GET /api/trace` (`explanations`, keyed by span id), `POST /api/decide-test` with `"explain": true`; `meaning` on `GET /api/policies` rows; `POST /api/policies/explain {id, text}`. `/mcp` errors keep exactly `decision, reason, rule, rules`; read the explanation through the Trace API using the returned `traceparent`.
- The explanation is checked against Cedar's own answer. If the two ever disagree it drops its per-rule reasons and says "Per-rule detail could not be checked for this request"; it never changes a decision.

## Tests

```sh
npm test      # server (vitest: Cedar behind a no-network guard, then the app), then web (vitest, jsdom)
```

On Node 26: server 527 passed, 0 failed (30 files); web 162 passed, 0 failed (14 files). `npm run doctor` is all ok.
Browser stories: `npm run build && npm run e2e` (S04, S01, S23, S05, and a check that the browser console has no errors) and `npm run e2e:utility` (the utility pack, light and dark at desktop and 375 px) drive the real UI in Chromium (`npx playwright install chromium`); `npm run check:diagrams` runs the family's label-overlap detector on every diagram at three widths. They are not part of `npm test`.

## Troubleshooting

1. **The toggle will not switch to Live.** It names the missing settings: add `PF_URL` and `PF_AUDIENCE` to `~/Development/.env` and restart. In Docker the container only sees that file through the overlay: `docker compose -f docker-compose.yml -f docker-compose.shared-env.yml up --build -d` (the file is mounted read-only; the app keeps only the keys it allows). A PingFederate on your own machine is not reachable from the container at `127.0.0.1`, and a PingFederate with an expired or self-signed certificate fails the TLS check by design.
2. **"Mock sign-in is off" on the first page.** Start with `npm start` (it allows mock sign-in on 127.0.0.1), or set `ALLOW_MOCK_SIGNIN=1`. It is refused behind a proxy, on a non-loopback bind, and in Live mode.
3. **403 `host_not_allowed`.** The page was reached by a name that is not loopback. Use http://127.0.0.1:4510, or add the name to `LAB_ALLOWED_HOSTS`.
4. **Port in use.** See Ports above.
5. **Every call is denied.** A policy file under `DATA_DIR/policies/active` does not compile. `GET /api/preflight` names it; fix it, or press Reset demo as Dana, or run `npm run reset`.

## Not verified / known limits

- Whether a real PingFederate puts `groups` and an object-valued `act` in access tokens: UNVERIFIED. This app has only been run against the local stub and the in-process mock.
- One process. Approvals, sessions and the trace buffer are in memory and lost on restart; policies and `audit.jsonl` are files under `DATA_DIR` (one folder per workspace). Not for hosted use.
- No demo persona is in `finance`, so `pay_invoice` is reachable only with a token that has that group (`stub-issuer/mint.mjs --groups finance`), or through Test a request.

## What is here

- `server/`: Express (ESM). `src/app.js` exports `createApp()`; `src/cedar/` is the decision module; `src/packs/` the vertical packs.
- `web/`: React + Vite; the page is picked by path in `src/main.jsx` (no router). Diagrams are diagram-studio/1 data in `src/diagrams/`.
- `stub-issuer/`: the local demonstration issuer and its `mint.mjs` CLI (live-mode testing only).
- `scripts/`: `doctor.mjs`, `reset.mjs`, `start.mjs`, `smoke.mjs`, `e2e.mjs`, `pingfederate-setup.sh`, `check-ui-standard.sh`.
- Docs: [talk track](docs/talk-track.md), [architecture and claim mapping](docs/architecture.md), [group-to-tool mapping](docs/group-to-tool-mapping.md), [how to add a policy](docs/add-a-policy.md), [security notes](docs/security.md), [gateway front-door OIDC (pingone.env)](docs/pingone-env-config.md), [utility pack](docs/utility-pack.md), [CHANGELOG](CHANGELOG.md). `content-pack.json` is the Learning Hub pack; `docs/shelf-entry.json` is the shelf entry.

## Ownership

Owner: the Ping demo family owner. Licence: private and unlicensed, for internal Ping demo use (see LICENSE); Cedar and `@cedar-policy/cedar-wasm` are Apache-2.0. Report problems on the repository's issues, or to the owner.

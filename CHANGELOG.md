# Changelog

## Unreleased (explain every decision)

- Every decision now says why, in plain English, built from the real evaluation and never typed per scenario: who is asking (person, groups, the agent acting for them), what was asked (tool, app, the amount, attended or unattended), one sentence naming the deciding rule, and "Rules checked" (each active rule: allowed it, blocked it, held it, did not apply with the true reason, or not about this tool), plus what would change the answer and who must approve and where. It is the new `explanation` object on `POST /api/tools/call`, on approvals, in `GET /api/trace` (`explanations`, keyed by span id) and on `POST /api/decide-test` with `explain: true`. Decisions, the hold and approval flow, the audit log, the trace events and the `/mcp` error shape are unchanged.
- How: Cedar is asked once more, over permit-only pieces of each policy (the whole rule, each scope part, each condition), which pieces hold for this exact request. The answer is checked against `decide()`; on any disagreement the explanation drops its per-rule reasons and says so.
- AI Policies: each rule shows what it does, who it covers, which tools, its conditions, whether it allows, blocks or holds, how rules combine, up to two examples computed from real answers, and a glossary. Rules whose shape cannot be put into words are shown as "explained from its text". `GET /api/policies` rows carry `meaning`; `POST /api/policies/explain` previews unsaved text.
- `GET /api/trace` returns an explanation only to the requester, a named approver and an admin. "What would change the answer" is checked by running the request again with that one change, so it never promises an Allow that a second rule would still deny.
- Tool console: a dismissible "How this works" strip, "Try this" buttons that fill in the form (never call) with what to expect in words, a hint under the agent box and the amount field. A test proves each printed expectation equals the real outcome, for both packs.
- Fix pass after a browser run: the utility pack's repo-scope and restricted-evidence Deny cards no longer end with "Some conditions could not be put in words" (every condition is in words); a Try-this button written for another person is disabled; the generic pack gains "Mary tries to book a fare"; an approver reading a Hold is no longer told to sign in as themselves.

## 0.4.0 (standalone completion)

- Mock mode is the default: an in-process mock issuer signs tokens labelled mock, `POST /api/mock/token` hands one to the signed-in persona, and `/mcp` works offline. Live mode (PingFederate) is the opt-in; the header toggle switches between them on every page and the banner says which is on.
- Network guard with a self-test and a mutation-proof test: zero outbound calls in mock mode; live mode reaches only `PF_URL`'s origin.
- One shared settings file (`~/Development/.env` or `STANDALONE_ENV`, allowlisted keys only); `DEMO_MODE` replaces `IDP`; mock sign-in follows rule 11 (`NODE_ENV` is no longer a guard; `LAB_PUBLISH=loopback` for Docker).
- `GET /api/health` is `demo-health/1`; `npm run doctor` and `npm run reset [workspace]`; workspaces (`X-Workspace`); presenter mode; `customer.config.json` for names and nouns; `docs/talk-track.md`.
- Host check, same-origin JSON-only writes, bundled fonts, `Content-Security-Policy`.
- Web: the shared stylesheet and the CSS standard (tokens only), diagram-studio/1 diagrams with Simulate, Reset and speed, a theme picker that only sets `data-theme`.
- Docker is mock-first (the stub issuer is behind `--profile stub`); app port 4510 (dev server and tests 4760-4769); Node 26; CI on hosted runners (build, test, doctor, forbidden-strings, gitleaks); Learning Hub pack (D1) and shelf entry.
- Fix pass: the doctor checks Node 26 or newer (it said 22); the browser console stays clean (`GET /api/session` answers 200 with `me: null` when signed out, the console calls `/api/tools/call?envelope=1` so a Deny is a 200 with the outcome in the body, and Live without settings shows the fix without sending the request that would answer 409); `npm run e2e` fails on any console error.
- Imported without history; internal names and a customer-specific slogan were scrubbed.

## Earlier (before the standalone import)

- Optional vertical pack `PACK=utility` (utility / NERC CIP-style): 13 mock tools, invented groups, per-repo scoping and data classification as Cedar resource attributes, holds for Priya, always-deny merge / approve / policy change / `deploy.*`, user + agent + tool on every trace row, five stories, `npm run e2e:utility`. Default pack and the `/mcp` contract unchanged. Docs: `docs/utility-pack.md`, utility section in `docs/group-to-tool-mapping.md`.

- At 800 px and below the page columns use `minmax(0, 1fr)` so a long policy id cannot widen the page.

## 0.3.1 (review fixes)

- A forbid without `@approvers` is final: the deciding policy of a deny is the first such forbid that fired, even when an approvable one (s01) also fired. A hold needs every fired forbid to name approvers.
- Audit lines keep their `trace_id` (id fields are exempt from the hex-secret check, free text is not).
- Compose: the stub issuer is on a user-defined network (`http://stub-issuer:9031`), so restarting either container works. `PF_HTTP_HOSTS` names the hosts allowed over plain http besides loopback.
- Tests for the policy-id guard, Bearer-only `/mcp`, empty JWKS, Approvals self-approve, Diagram Reset, the Overridden list and story/policy id drift. `/approvals` no longer scrolls sideways at 390 px; the speed slider uses the theme accent.

## 0.3.0 (step P3: Docker, end to end, docs)

- `docker compose up` runs the app in PF mode plus a clearly labelled local stub issuer (`stub-issuer/`: key pair generated at start, JWKS, local-only `mint.mjs` CLI). Real PingFederate: set `PF_URL` and `PF_AUDIENCE`, start only the app.
- `npm run smoke`: checks a running stack by content (health, web page, valid and tampered Bearer tokens, every group x tool cell through `POST /mcp`, hold and approval).
- `npm run e2e`: Playwright run of stories S04, S01 (two browser contexts), S05 and S23 on the host-run app, with screenshots.
- Preflight: `GET /api/preflight`, a "Setup needed" card on the Sign in page, `fix` text on a Bearer 401 when PF is not configured, `npm run doctor` checks PF settings and the JWKS.
- Dev: `VITE_PORT` and `PORT` choose the Vite and API ports.
- docs/: architecture and claim mapping, group-to-tool mapping, how to add a policy, security notes. README rewritten to match what runs.

## 0.2.0 (steps P1, P2)

Server (sign-in, mock MCP backend, PEP, approvals, policy store, trace), web (AI Policies, console, approvals, trace, stories, diagram).

## 0.1.0 (step P0)

Scaffold: npm workspaces, Dockerfile, compose, CI, doctor. Cedar decision module (lane B).

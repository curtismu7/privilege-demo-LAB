# Changelog

## Unreleased

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

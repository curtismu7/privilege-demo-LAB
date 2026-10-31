# Security notes

This is a demo for a trusted laptop or a private lab. It is not a product and it is **not for hosted use**.

## Mock sign-in guards (host-run only)

The persona picker exists only when all of these hold; every request re-checks them:

- `IDP=local-mock` and `ALLOW_MOCK_SIGNIN=1` (the literal `1`).
- `NODE_ENV` is not `production`; the server refuses to start with the mock on in production.
- The listener is loopback (`HOST=127.0.0.1`), the socket peer is loopback, the `Host` header is loopback, and no proxy header is present (`Forwarded`, `X-Forwarded-*`, `Via`, `True-Client-IP`, `CF-*`).
- Dana (admin) also needs the file `DATA_DIR/ALLOW_ADMIN_PERSONA`; without it she is not offered and her login is a 404.

Docker containers run `NODE_ENV=production`, `IDP=pf`, `ALLOW_MOCK_SIGNIN=0`: the mock routes are not mounted at all. `npm run smoke` proves it against the running container (the mock login is a 404).

## Tokens

- Bearer tokens are verified with `jose` against the PingFederate JWKS: issuer, audience, expiry, RS256 or ES256 only (never `none` or HMAC), clock skew at most 60 s.
- Tokens, claims objects and secrets are never logged, traced, audited or returned. Sentinel tests assert it. Caller-controlled strings that look like credentials are withheld from the audit log.
- A token with no `groups` claim is refused, not treated as "no groups".
- The session cookie is signed and `HttpOnly`; it is only used in mock mode.

## The stub issuer

`stub-issuer/` is **for local demonstration only**. It generates a key pair at every start (in memory, never written or printed), serves its JWKS, and mints tokens for the demo personas. Minting works only from a loopback peer (inside the stub container, via `docker compose exec`); the app container reaches it over the compose network but its mint requests are refused, and the compose file publishes no port for it. Anyone who can run `docker compose exec` on your machine can mint a token; that is the point. Never point a real deployment at it, and never expose its port.

## What this is not

- **Not multi-tenant.** One policy store, one approval queue and one trace buffer per process; no tenant or workspace ids. Everyone who can sign in sees the same state.
- **Not hosted.** There is no rate limiting and no TLS (the mock session cookie is `SameSite=Strict`, and there is no separate CSRF token). Run it on your own machine.
- **State is in memory** (approvals, sessions, trace); a restart loses it. Policies and `audit.jsonl` are files under `DATA_DIR`.
- The admin can edit policies with arbitrary Cedar text; validation checks syntax and schema, not intent.

## Secrets in the repo

`.env` is gitignored; `.env.example` has no secrets. A gitleaks pre-commit hook (`.githooks/pre-commit`) and CI job guard against commits. No tenant ids or private hostnames are in the repo.

## Notes added from an integration check

- **Loopback by default (all modes).** Host-run binds `127.0.0.1` unless `HOST` is set; the container sets `HOST=0.0.0.0` inside itself and `docker-compose.yml` publishes only on `127.0.0.1` (pinned by `server/test/app/loopback.test.js`). Earlier versions bound all interfaces whenever the sign-in mode was not the local mock, and compose published without the loopback prefix.
- **Token scope is not enforced.** Decisions use the user's groups, the tool and its resource attributes; an OAuth `scope` claim in the Bearer token is ignored. A token carrying only `github:read` is still allowed to run any tool its groups permit. Do not claim scope enforcement in a talk track.
- **Strict tool arguments.** Tool arguments are validated strictly (for example an enum of repos, and required `collection` / `logGroup`); a wrong shape is denied as `invalid-arguments` before policy runs.

## Agent-subject token (utility pack, unattended lane)

`PACK=utility node stub-issuer/mint.mjs --agent delivery-agent` (or `POST /mint {"agent":"delivery-agent"}` on the stub, loopback only) mints a token where the **agent is the subject**: `sub=delivery-agent`, **no `act` claim**, `scope=tools:invoke`, `client_id=privilege-demo-agent`, and the pack's invented agent groups `engineers` and `business-analysts` (override with `groups`). Only the pack's own agent identity can be minted, and it cannot be combined with a persona or `act`.

No policy changed: the PEP builds the principal as `User::<sub>` with the token's groups, so the agent is governed by the same rules as a person with those groups. In the utility pack that means the read tools are allowed (repo-scoped by u40), `backlog.update_story` and `confluence.update_requirement` are HELD with the named approver (`priya`), the always-denied tools stay denied, and restricted evidence is denied (u41). The decision action is `mcp:Invoke`, not `mcp:InvokeUnattended`, because the unattended action is keyed on the presence of `act`; policy text therefore cannot tell this call apart from an attended one. Trace attribution shows the agent as the user (`user=delivery-agent, agent=null`).

The groups are invented demo data, not real PingFederate or Privilege groups. UNVERIFIED: how a real PingFederate would issue a token whose `sub` is a workload/agent identity.

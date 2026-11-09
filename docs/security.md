# Security notes

This is a demo for a trusted laptop or a private lab. It is not a product and it is **not for hosted use**.

## Mock sign-in guards

The persona picker exists only when all of these hold; every request re-checks them (rule 11):

- `ALLOW_MOCK_SIGNIN=1` (the literal `1`) and the app is in Mock mode. In Live mode the picker is refused.
- The listener is loopback (`HOST=127.0.0.1`), or the port is published on loopback only: the Docker image listens on `0.0.0.0` inside the container, and `docker-compose.yml` sets `LAB_PUBLISH=loopback` because it publishes on `127.0.0.1` only (pinned by `server/test/app/loopback.test.js`). Outside Docker the socket peer must also be loopback.
- The `Host` header is loopback, and no proxy header is present (`Forwarded`, `X-Forwarded-*`, `Via`, `True-Client-IP`, `CF-*`). One exception (owner, 2026-11-08): behind the lab-proxy the `Host` is a `LAB_ALLOWED_HOSTS` name (loopback does not count) and the proxy headers are tolerated; a loopback or unlisted `Host` with a proxy header is still refused.
- `NODE_ENV=production` is **not** a guard: the Docker images set it.
- Dana (admin) also needs the file `DATA_DIR/ALLOW_ADMIN_PERSONA`; without it she is not offered and her login is a 404.

`npm start` sets `ALLOW_MOCK_SIGNIN=1` because it is the loopback-only host-run launch; a direct `node server/src/index.js` does not. The mode toggle (`PUT /api/mode`) and the script reset route (`POST /api/workspaces/<id>/reset`) need the same local-request conditions (loopback, no proxy header, loopback Host; or a `LAB_ALLOWED_HOSTS` Host behind the lab-proxy); the reset also accepts an admin.

## Network: nothing leaves the machine in mock mode

`server/src/netguard.js` is the only door out. In Mock mode every request is refused before a socket opens and the real `fetch` is never called; in Live mode only the origin of `PF_URL` is reachable (https or the named plain-http stub host, no redirects, a time cap). The guard runs a self-test at start and in `npm run doctor`; tests assert zero attempts across sign-in, the console, approvals, `/mcp`, preflight and health, and a mutation test removes the mock refusal from the module and shows the self-test fails. The page loads nothing from outside the app (fonts are bundled; the CSP is `default-src 'self'`).

Every request must come to a loopback `Host` (plus `LAB_ALLOWED_HOSTS`), so a rebound DNS name gets nothing. A write with an `Origin` that is not the page's own host, or a cross-site `Sec-Fetch-Site`, is refused, and a body must be JSON.

## Tokens

- Bearer tokens are verified with `jose` against the PingFederate JWKS: issuer, audience, expiry, RS256 or ES256 only (never `none` or HMAC), clock skew at most 60 s.
- Tokens, claims objects and secrets are never logged, traced, audited or returned. Sentinel tests assert it. Caller-controlled strings that look like credentials are withheld from the audit log.
- A token with no `groups` claim is refused, not treated as "no groups".
- The session cookie is signed, `HttpOnly` and `SameSite=Strict`; it is only used in Mock mode, and there is one per workspace (`pd_session_<workspace>`, with the workspace signed inside it).
- Mock-issued tokens are made by an in-process issuer (a P-256 key from `createECDH`, never written or printed), carry a `mock` claim and header and an issuer on a `.invalid` host, and are shown whole and labelled mock. Live tokens are verified, never stored or logged.

## The stub issuer

`stub-issuer/` is **for local demonstration only**. It generates a key pair at every start (in memory, never written or printed), serves its JWKS, and mints tokens for the demo personas. Minting works only from a loopback peer (inside the stub container, via `docker compose --profile stub exec`); the app container reaches it over the compose network but its mint requests are refused, and the compose file publishes no port for it. Anyone who can run `docker compose exec` on your machine can mint a token; that is the point. The stub is only used when you add the `stub` compose profile. Never point a real deployment at it, and never expose its port.

## What this is not

- **Workspaces are a demo convenience, not tenants.** Each workspace id has its own policy store, approval queue, drift state, trace buffer, audit log and sign-in, so two presenters on one laptop do not collide, and reset clears one. Anyone who can reach the app can name any workspace (at most 20); there is no authorization between them.
- **Not hosted.** There is no rate limiting and no TLS (the mock session cookie is `SameSite=Strict`, and there is no separate CSRF token). Run it on your own machine.
- **State is in memory** (approvals, sessions, trace); a restart loses it. Policies and `audit.jsonl` are files under `DATA_DIR`.
- The admin can edit policies with arbitrary Cedar text; validation checks syntax and schema, not intent.

## What the explanation shows

The decision card repeats values from the token (the sub, groups, scopes, the agent) and from the request. These come from a caller (in live mode from PingFederate), so every such value is stripped of control and format characters, cut to a fixed length (at most 20 groups and 20 scopes are listed), and replaced by `[withheld]` if it looks like a credential (the same guard the trace uses). Free-text arguments (a subject, a query, a body, a justification) are never shown; only values a rule actually reads (the amount, the repository, the data classification) are. The page renders every sentence as plain text. The audit log does not carry the explanation. Persona names appear only in mock mode: a live user whose sub is `mark` is shown as `mark`. The explainer makes no network calls (it is Cedar's wasm, behind the same no-network test as the rest of the engine).

## Secrets in the repo

`.env` is gitignored; `.env.example` has no secrets. Settings come from the shared `~/Development/.env`, of which only this app's keys are read (`server/src/settings.js`); admin and worker credentials are never read. A gitleaks pre-commit hook (`.githooks/pre-commit`) and the CI gitleaks and forbidden-strings jobs guard against commits. No tenant ids or private hostnames are in the repo.

## Notes added from an integration check

- **Loopback by default (all modes).** Host-run binds `127.0.0.1` unless `HOST` is set; the container sets `HOST=0.0.0.0` inside itself and `docker-compose.yml` publishes only on `127.0.0.1` (pinned by `server/test/app/loopback.test.js`). Earlier versions bound all interfaces whenever the sign-in mode was not the local mock, and compose published without the loopback prefix.
- **Token scope is not enforced.** Decisions use the user's groups, the tool and its resource attributes; an OAuth `scope` claim in the Bearer token is ignored. A token carrying only `github:read` is still allowed to run any tool its groups permit. Do not claim scope enforcement in a talk track.
- **Strict tool arguments.** Tool arguments are validated strictly (for example an enum of repos, and required `collection` / `logGroup`); a wrong shape is denied as `invalid-arguments` before policy runs.

## Agent-subject token (utility pack, unattended lane)

`PACK=utility node stub-issuer/mint.mjs --agent delivery-agent` (or `POST /mint {"agent":"delivery-agent"}` on the stub, loopback only) mints a token where the **agent is the subject**: `sub=delivery-agent`, **no `act` claim**, `scope=tools:invoke`, `client_id=privilege-demo-agent`, and the pack's invented agent groups `engineers` and `business-analysts` (override with `groups`). Only the pack's own agent identity can be minted, and it cannot be combined with a persona or `act`.

No policy changed: the PEP builds the principal as `User::<sub>` with the token's groups, so the agent is governed by the same rules as a person with those groups. In the utility pack that means the read tools are allowed (repo-scoped by u40), `backlog.update_story` and `confluence.update_requirement` are HELD with the named approver (`priya`), the always-denied tools stay denied, and restricted evidence is denied (u41). The decision action is `mcp:Invoke`, not `mcp:InvokeUnattended`, because the unattended action is keyed on the presence of `act`; policy text therefore cannot tell this call apart from an attended one. Trace attribution shows the agent as the user (`user=delivery-agent, agent=null`).

The groups are invented demo data, not real PingFederate or Privilege groups. UNVERIFIED: how a real PingFederate would issue a token whose `sub` is a workload/agent identity.

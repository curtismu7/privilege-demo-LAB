# pingone.env — configuring the gateway's front-door OIDC

This lab's PEP does its own token verification against PingFederate. When the Privilege MCP Gateway (mcpgw) is placed in front of an MCP server instead, the gateway runs the OAuth dance itself, and its OIDC configuration lives in one file: `pingone.env`. This page is the reference for that file. (Full deep-dive with binary audit evidence: `AI-DEMO2/privilege/MCPGW-PINGONE-ENV-CONFIG.md`.)

## How the file is read

The compose service `ping-mcpgw` consumes the file twice:

1. `env_file:` — every line is loaded as an environment variable in the container.
2. `-mcpconfpath /var/lib/procyon/config/pingone.env` — the `mcpgw` binary parses the same file directly at startup and **exits fatally** if the path does not resolve.

The file is gitignored; `pingone.env.example` is the template to copy.

## The keys

| Key | Example value | Purpose |
|---|---|---|
| `SERVER_URL` | `https://mcpgw.local.ping-devops.com` | Public front-door URL the 401 challenge advertises. Clients register redirect URI `${SERVER_URL}/callback` in PingOne. Must be browser-reachable. |
| `OIDC_CLIENT_ID` | (UUID) | PingOne application client ID. |
| `OIDC_CLIENT_SECRET` | (secret) | Copy character-for-character from the BFF `.env` (`PRIVILEGE_SSO_CLIENT_SECRET`). The chars `l` and `I` look identical in most fonts; one wrong char = `invalid_client`. |
| `OIDC_AUTH_URL` | `https://auth.pingone.com/<env-id>/as/authorize` | Authorization endpoint. |
| `OIDC_TOKEN_URL` | `https://auth.pingone.com/<env-id>/as/token` | Token endpoint. |
| `OIDC_USER_URL` | `https://auth.pingone.com/<env-id>/as/userinfo` | Userinfo endpoint. |
| `OIDC_SCOPES` | `openid profile email` | Must include `openid`, or the gateway gets no id_token and falls back to userinfo for identity. |
| `USER_ID_CLAIM` | `email` | Claim the gateway reads from the id_token to resolve the user. Absent claim → falls back to userinfo. `email` requires the `email` scope. Without this key the default is `sub`. |
| `USER_ID` | `you+demo-user@example.com` | Optional identity pin for flows that need a concrete resolved user. |
| `PINGONE_ENVIRONMENT_ID` | (UUID) | Reference only — the env-id is already embedded in the three `OIDC_*_URL` values. |

The config struct also carries `Issuer`, `SessionKey`, `ListenAddr`, `RedirectURI`, `TenantID`, `CertFile`, `KeyFile`, `LogLevel`, `Debug`, `OidcDomain`. These are not verified as settable from `pingone.env` — some belong to the console/guest-agent registration path. Do not add them speculatively.

## Related files

| File | Purpose |
|---|---|
| `proxy-token.env` | `ENV_PROXY_TOKEN=eyJ...` enrollment token from the console gateway wizard. Only needed on first boot or re-enrollment — afterwards the proxy authenticates with the mTLS cert pair in the `mcpgw-ssl` volume and ignores it. |
| `procyon-guest-agent.env` | Guest agent (native install) config, not the proxy. CamelCase keys: `OidcClientID`, `OidcUserIDClaim` (default `sub`), `OidcDomain`, `Tenant`, `APIKey`/`APISecret`, `CNTRLUrl`, `NodeType=MCPGw`. Its `APIKey`/`APISecret` authenticate to the Privilege control plane and are NOT the PingOne client credentials. |

## Gotchas

- **Front door vs backend hop.** `pingone.env` configures the *front door* (gateway authenticating MCP clients against PingOne). The *backend* hop (gateway → MCP server) is configured in the Privilege console (MCP Application, Auth Mode = Static Token empty) and is intentionally unauthenticated because the MCP server in this topology sets `MCP_AUTH_DISABLED=true`.
- **DCR state is in-memory.** After editing this file, restart mcpgw, then restart the BFF — mcpgw loses in-memory DCR client state on restart.
- **Mesh vs agentless.** This file only matters in *agentless / self-hosted frontend* mode, where the proxy binds locally and runs the OIDC dance itself. In mesh/cloud-frontend mode requests land on `*.applications.privilege.pingone.com` and the cloud validates the client JWT.

## Verify

```bash
docker logs ai-demo-ping-mcpgw 2>&1 | grep -E "OIDC|UserID|identity leg"
curl -si https://mcpgw.local.ping-devops.com/mcp | head -1
# expect: HTTP/1.1 401 with www-authenticate: Bearer realm="MCP OAuth Server", authorization_uri="..."
```

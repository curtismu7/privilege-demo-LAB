# Utility / NERC CIP-style pack: notes for the content pack and the shelf

An optional vertical pack beside the original demo. Select it with `PACK=utility`; the default (`PACK` unset or `generic`) is the original demo, unchanged. No customer is named anywhere in this repo.

**What is invented.** The groups (`engineers`, `governance-reviewers`, `business-analysts`, `compliance`), the people (Eli, Gwen, Ben, Cora, Priya, Dana), the repository names, the knowledge-base collections, the log groups and the group-to-tool assignment. The tool list and the allow / hold / deny split follow a generic utility use case; nothing else does. The page says this on every screen (an amber notice) and every tool is badged "Mock backend".

**What is not verified.** That a real organisation's groups look like these; how a real organisation would want "Pull Request Review" treated (it is the engineering review rules, read-only, no merge, no approve, until clarified); whether their PingFederate puts `groups` and an object-valued `act` in access tokens (same open question as the original demo); anything against a real GitHub, Confluence, backlog, CloudWatch or deploy system (all mocks).

## Mechanism (the smallest selector)

- `PACK=<id>` (config.js) picks a pack from `server/src/packs/index.js`. An unknown id stops startup naming the setting.
- A pack is: personas, the agent, a tool list (with mock `run` functions and an optional `resource(args)` giving Cedar resource attributes), an optional Cedar schema, shipped policies and the wording the page needs (`pack.json`). The Tool entity of the utility schema carries `toolName`, `classification` and optional `repo`.
- Policies are plain `.cedar` files (`server/src/packs/utility/policies/`), each with an `@reason`, and the rug-pull pin `s05-rugpull-pin` is reused from the original. A non-generic pack keeps its policy files in `DATA_DIR/policies-<id>/`, so switching `PACK` on one data directory never feeds one pack's policies to another pack's schema.
- The web page reads the pack from `GET /api/auth/config` (`pack`); stories and the vertical live in `web/src/data/packs/utility/`. With no pack data the page shows the original wording.

## The `/mcp` contract (stable)

JSON-RPC 2.0 over `POST /mcp`, `Authorization: Bearer <PF access token>` with `sub`, `groups`, `client_id`, and an optional object `act` (`{ "sub": "<agent>" }`). `initialize`, `ping` and `tools/list` return the pack's tools (13 here, each with `name`, `description`, `inputSchema`, `_meta.app`, `_meta.schemaHash`). `tools/call`: allow = `result.content[0].text` (JSON of the mock result, `"mock": true`); deny = error `-32003` with `data { decision, rule, reason, rules }`; hold = error `-32004` with the same plus `approvalId` and `approvers`. Unchanged from the original; `server/test/app/utility-pack.test.js` pins it for this pack. Tokens for local use: `PACK=utility node stub-issuer/server.mjs`, then `node stub-issuer/mint.mjs eli --act delivery-agent`.

## Shelf (demo launcher) notes

- Run it on its own port beside the original, for example 4762: `PACK=utility PORT=4762 npm start`. Health: `GET /api/health` (`{ "ok": true }`, same as the original).
- A shelf override entry (in the shelf's own local file, not in this repo) would be a second `privilege-demo`-style entry with `PACK=utility` in its environment and port 4762.
- Content-pack checklist when editing: change a policy (`server/src/packs/utility/policies`), then its row in `docs/group-to-tool-mapping.md` (utility section), then the story text (`web/src/data/packs/utility/stories`), then the mutation table in `server/test/cedar/utility-pack.test.js`. A test fails if a story names a policy or tool that no longer exists.
- Browser check: `npm run build && npm run e2e:utility` (default port 4762, `E2E_PORT` to change).

## Try this and the explanations

The Tool console's **Try this** buttons for this pack are the `tryThis` array in `pack.json` (twelve buttons that follow the tables in `group-to-tool-mapping.md`, plus two example-only requests used for the rule examples). Every decision card explains itself: who is asking, the repository and data classification when a rule reads them, and each rule's status. `server/test/app/tryit.test.js` proves every printed expectation against the real app.

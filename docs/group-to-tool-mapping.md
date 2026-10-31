# Group to tool mapping (story S35)

The groups are invented for the demo; they are not real PingFederate or Privilege groups. The mapping is decided only by the six shipped policies. Every cell below is checked three ways: the Cedar test table (`server/test/cedar/mapping.test.js`), the app test (`server/test/app/pep.test.js`), and `npm run smoke`, which asks a running container through `POST /mcp`.

Personas: Mark and Priya are in `travel-agents`, Mary in `analysts`, Dana in `admins`. No persona is in `finance`; the finance cells need a token with that group.

| Group | `search_flights` | `create_ticket` | `pay_invoice` | `book_fare` |
|---|---|---|---|---|
| `analysts` | allow (`s04-analysts-search-ticketing`) | allow (`s04-analysts-search-ticketing`) | deny (default) | deny (default) |
| `finance` (with scope `payments:write`) | deny (default) | deny (default) | allow (`s04-payments-finance-only`) | deny (default) |
| `travel-agents` | deny (default) | deny (default) | deny (default) | allow (`s23-permit-travel-agents`) |
| `admins` | deny (default) | deny (default) | deny (default) | deny (default) |

Rules that cut across the table:

| Situation | Outcome | Deciding policy |
|---|---|---|
| `finance` without the `payments:write` scope calls `pay_invoice` | deny | default |
| Unattended call (token has `act`, for example Dot acting for Mark) to `book_fare` over 1000, no approval yet | **hold** for `priya` | `s01-hold-large-fare` |
| The same call after Priya approves | allow | `s23-permit-travel-agents` |
| `book_fare` over 10000, anyone, with or without an approval | deny | `s23-forbid-over-cap` (overrides the permit) |
| Any tool whose schema hash differs from the pinned one | deny | `s05-rugpull-pin` |
| A call with no matching permit | deny | default-deny |

`admins` have no tool policy on purpose: administration (editing policies, making a tool drift) is a separate capability of the web app, not a tool permission. This demo does not add an admins policy beyond what the plan states.

The AI Policies page shows this table live (it asks the real policies once per cell), so an edit to a policy changes the table.

---

# NEW: utility / NERC CIP-style pack (`PACK=utility`)

This section is new and separate. The table above is the original demo's and is unchanged. Everything below applies only when the server runs with `PACK=utility`.

The four groups (`engineers`, `governance-reviewers`, `business-analysts`, `compliance`) and the people in them are **invented for the demo**. They follow a generic utility use case only in the sense that the tools and the allow / hold / deny split follow it; which group gets which tool is this demo's reading, not any customer's. Every backend is a **mock**. Personas: Eli (engineers; also the "Pull Request Review" persona, treated as the engineering review rules, read-only, no merge, no approve, until it is clarified), Gwen (governance-reviewers), Ben (business-analysts), Cora (compliance), Priya (approver, named by the hold policies; sits in governance-reviewers), Dana (admin, needs the switch file). The agent is `delivery-agent` (the token's `act.sub`).

Resource attributes the policies read: `repo` (GitHub tools) and `classification` (`restricted` for the kb collection `audit-evidence` and the log group `security-events`, else `internal`). Both are set by the server from its own mock catalog; a caller cannot label its own request.

| Tool | `engineers` | `governance-reviewers` | `business-analysts` | `compliance` |
|---|---|---|---|---|
| `github.read_pr` | allow, own repos only (`u10`; other repos: deny `u40`) | allow, any repo (`u12`) | deny (default) | allow, any repo (`u14`) |
| `github.post_review_comment` | allow, own repos only (`u10`; `u40`) | allow (`u12`) | deny (default) | deny (default) |
| `kb.search` | allow, internal collections (`u11`) | allow, internal (`u12`) | allow, internal (`u13`) | allow, including restricted (`u14`) |
| `cloudwatch.query_logs` | allow, internal log groups (`u11`) | deny (default) | deny (default) | allow, including restricted (`u14`) |
| `backlog.create_story_draft` | deny (default) | deny (default) | allow (`u13`) | deny (default) |
| `backlog.update_story` | deny (default) | deny (default) | **hold** for `priya` (`u30`), allow after approval | deny (default) |
| `confluence.update_requirement` | deny (default) | **hold** (`u31`) | **hold** (`u31`) | deny (default) |
| `github.merge_pr`, `github.approve_pr` | deny (`u20`) | deny (`u20`) | deny (`u20`) | deny (`u20`) |
| `policy.change` | deny (`u21`) | deny (`u21`) | deny (`u21`) | deny (`u21`) |
| `deploy.*` (any tool whose name starts with `deploy.`) | deny (`u22`) | deny (`u22`) | deny (`u22`) | deny (`u22`) |

Rules that cut across the table:

| Situation | Outcome | Deciding policy |
|---|---|---|
| Restricted evidence (`audit-evidence`, `security-events`) asked for by anyone outside `compliance` | deny, overriding the group's permit | `u41-restricted-evidence-compliance-only` |
| An engineer reads or comments in a repo other than `grid-ops-portal` or `outage-notifier` | deny, overriding `u10` | `u40-repo-scope-engineers` |
| A held call after one approval from `priya` | allow (runs once) | the group's permit (`u13`, `u12`) |
| `github.merge_pr`, `github.approve_pr`, `policy.change`, `deploy.*`, with any number of approvals | deny; no approvers are named, so there is no hold | `u20`, `u21`, `u22` |
| A tool name the pack does not list (for example `deploy.canary`) | deny before policy (`unknown-tool`). The `u22` pattern itself is tested against unlisted `deploy.*` names | n/a |
| Any tool whose schema hash differs from the pinned one | deny | `s05-rugpull-pin` (kept from the original) |
| A call with no matching permit | deny | default-deny |

Holds apply with or without the agent (`act`), because every write to the backlog or requirements is meant to be seen by a person. Every decision names the user (token `sub`), the agent (`act.sub`, when present) and the tool: in the result card (`attribution`) and on each policy, pep, tool and approval row of the trace (`tool` field).

Checked by `server/test/cedar/utility-pack.test.js` (every row above, plus a mutation check: deleting or weakening each policy must change a decision), `server/test/app/utility-pack.test.js` (PEP, approvals, trace, `/mcp`) and `npm run e2e:utility` (real browser).

Notes on reading the table: `u30` and `u31` are forbid rules that name approvers, and they apply to everyone. A persona with no permit for the tool (Eli on `backlog.update_story`) is therefore denied with the `u30` rule name, not held, and no approval is created. Priya is the only named approver for `u30`, and she cannot approve her own call, so if she calls `confluence.update_requirement` herself only the admin can release it.

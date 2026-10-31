# Talk track: Privilege demo LAB

About 10 minutes. The point: an AI agent's tool calls pass one door. Policy decides at that door, a person stays in the loop for
the risky call, and every hop is on the record. Nothing here needs a real tenant.

Use **Mock** to rehearse or when you have no PingFederate (nothing leaves the laptop). Use **Live** only to show your own
PingFederate's access tokens. Say which one is on: the banner under the header always does, and presenter mode keeps it on screen.
The Cedar decisions are real in both. The people, groups and tool backends are invented.

## Before you start

1. Run `npm run doctor`. Every line should say `ok`.
2. Open http://127.0.0.1:4510. The header toggle says **Mock**.
3. Pick a workspace name for this session in the header (for example `acme-demo`). `npm run reset acme-demo` clears only that
   workspace, so a second presenter on the same laptop keeps their state.
4. Press **Presenter** to hide the nav and open the talk track on each page. **Esc** brings the nav back.
5. To use the customer's words, copy `customer.config.example.json` to `customer.config.json` and rename the people and nouns
   (the stories keep their `{{cast}}` tokens, so the story text changes with it). It is gitignored.

## The story (one minute)

"Your agents call tools. The question is not whether the agent is smart, it is who decided it may make *this* call. Every call goes
through one door. The door reads who the person is from their access token, asks a policy engine, and does what the answer says."

## The stories, in order

1. **Mary gets 2 of 3 tools (S04, Tool console).** Sign in as Mary (analyst). Call `search_flights` (allow), `create_ticket`
   (allow), `pay_invoice` (deny). Open the result: the deciding policy and its reason are on the card. Say: "Same agent, different
   person, different answer, and the policy that said so is named."
2. **Mark's booking needs a second pair of eyes (S01, Tool console, then Approvals).** Sign in as Mark. Call `book_fare`, amount 2400,
   tick "Dot makes the call". It is **held**: nothing ran. Sign in as Priya in a second browser window (or sign out and back in),
   open Approvals, show the request, approve. It runs once. Say: "Mark cannot approve his own request, and the approval is
   re-checked against today's policies."
3. **The hard cap (S23, AI Policies).** Test a request: `book_fare` 10,001 as Mark. Deny, naming the forbid and the permit it
   overrode. Say: "A forbid beats a permit, so a broad permit can never undo a hard limit."
4. **Groups to tools (S35, AI Policies).** Scroll to the table: one decision per group and tool, asked of the live policies. Edit a
   policy as Dana (needs the admin switch file, below), save it as a **Candidate**, and show the shadow diff in Test a request
   before promoting it.
5. **The tool list changed overnight (S05, Tool console).** As Dana, press "Make schema drift" on a tool. Sign in as Mary and call it:
   denied by the pin, for everyone. Say: "A rug pull is caught because the approved description was hashed at onboarding." Press
   **Reset demo** on AI Policies (or `npm run reset`) to put it back.
6. **Follow it in the trace (Trace).** One request reads auth, Cedar, enforcement point, then tool and approval. One traceparent, who
   decided at each hop, no tokens stored.
7. **The diagrams (Diagram).** Three movable diagrams: one call, a held call, a rug pull. Press Simulate, change the speed, drag a
   box, press Reset.

Dana (admin) is hidden until you create the switch file: `touch .data/ALLOW_ADMIN_PERSONA` (in Docker:
`docker compose exec privilege-demo-lab touch /data/ALLOW_ADMIN_PERSONA`).

## Trying the MCP door from a terminal

In mock mode, the Tool console has **Get a mock token**: a token for the signed-in person, signed by the in-process mock issuer
(not PingFederate) and labelled mock. Paste it into the example `curl` to call `tools/list` and `tools/call` on `POST /mcp`. In live
mode, send an access token from your own PingFederate the same way.

## Mock versus live, in one sentence

"Mock is a stand-in so you can rehearse anywhere; Live checks tokens from your real PingFederate, and the same policies decide."
Live needs `PF_URL` and `PF_AUDIENCE` (see the README); the toggle says what is missing if they are not set.

## If something goes wrong

- A banner says what the page is. If the toggle refuses Live, it names the setting to add.
- "Sign in first" on a page: sign in on the first page; each workspace has its own sign-in.
- A held request that nobody answers expires after ten minutes and stays denied.
- `npm run reset [workspace]` puts the policies back to the shipped set and clears approvals, drift and the trace for that workspace.

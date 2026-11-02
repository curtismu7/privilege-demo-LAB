# How to add a policy

Policies are Cedar text. The vocabulary mirrors what the Privilege console editor exposes, so text written here can be pasted there (the fields marked "demo" in `server/src/cedar/schema.cedarschema` are extensions the console does not have).

## In the app (Dana, admin)

1. Sign in as Dana (needs the admin switch file, see the README) and open **AI Policies**.
2. Choose **New policy**, give it an id (letters, digits, `.`, `_`, `:`, `-`), and write the text. The `@id` annotation must equal the id.
3. **Validate** runs the server-side check (syntax, then the schema). Problems are listed with the policy id; nothing is installed.
4. **Save as Candidate** stages it: **Test a request** then shows the Active answer next to what the Candidate would change, and live traffic is not affected.
5. **Save as Active** installs it. A set that does not validate is refused with 422 and the old set stays.
6. **Reset demo** restores the six shipped policies and clears Candidates, approvals, the trace and any drift.

## Annotations

| Annotation | Meaning |
|---|---|
| `@id("...")` | the policy id shown as the deciding rule |
| `@reason("...")` | the sentence shown to the user and in the trace |
| `@approvers("priya")` | on a `forbid`: a denial by this policy becomes a **hold** for these people (space or comma separated) |

## Context you can use

`principal in Group::"x"`, `action == Action::"mcp:Invoke"` or `"mcp:InvokeUnattended"`, `resource == Tool::"book_fare"`, and in `when` / `unless`: `context.app`, `context.args.amount` (guard it with `context.args has amount`), `context.token.scopes.contains("...")`, `context.token.client_id`, `context.token.actor`, `context.approval_count`, `context.pinnedHash` / `context.observedHash`.

## Example: a booking cap for one group

```cedar
@id("s99-agents-small-fares")
@reason("Travel agents may book fares up to 500 without review")
permit (principal in Group::"travel-agents", action == Action::"mcp:Invoke", resource == Tool::"book_fare")
when { context.args has amount && context.args.amount <= 500 };
```

Remember Cedar semantics: no permit means deny; any matching `forbid` beats every `permit`.

## How the page explains your policy

After you save, **AI Policies** shows what the rule means in plain words, and every decision card lists it under Rules checked. While you type, the meaning of the unsaved text is previewed. The explanation follows the saved text: change `1000` to `500` and the next card says 500.

The page can put these shapes into words: scope `principal in Group::"x"` or `== User::"x"`; `action == Action::"mcp:Invoke"` / `"mcp:InvokeUnattended"` or `in [both]`; `resource == Tool::"x"`; and in `when` / `unless`: `context.app == "x"` (or several joined with `||`), `[Tool::"a", Tool::"b"].contains(resource)`, `resource.toolName like "p*"`, `context.args has amount` and `context.args.amount > N` (also `>=`, `<`, `<=`, `==`, `!=`), `context.approval_count >= 1`, `context.token.scopes.contains("s")`, `context.token.client_id == "x"`, `context.pinnedHash != context.observedHash`, `resource has repo`, `[...strings].contains(resource.repo)`, `resource.classification == "x"`, `principal in Group::"x"` inside a condition, and `!` of any of these. A top-level `&&` in a `when` is split into parts.

Anything else (arithmetic, other `||`, extension functions, records) is shown as **Explained from its text**: the `@reason` and the Cedar source, with the condition Cedar could not put into words quoted as written. Nothing is guessed. Give every policy a clear `@reason`: it is what a reader sees in that case.

## In the repo

A shipped policy is a file in `server/src/cedar/policies/<id>.cedar` (the file name is the id). Add the file, add its cells to `server/test/cedar/mapping.test.js`, and run `npm test`. Policy text that is not specific to this demo's invented groups should keep the comment line saying the groups are invented.

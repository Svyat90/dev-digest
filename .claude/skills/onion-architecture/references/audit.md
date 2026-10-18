# Module audit — order of checks

Use when reviewing a server module or PR for structure. Go file by file, and in
each file run the passes in this order. The order matters: the earlier passes find
the problems that make the later ones unfixable (a service that builds its own
adapter cannot be given a fake, so there is no point asking about its tests).

1. **Imports** — what does this file name?
2. **Construction** — who builds the things it uses?
3. **Ports** — does every outside call go through a port that really has that method?
4. **Tenancy** — is every read and write of a domain table scoped by workspace?
5. **Writes** — are multi-step writes atomic, and is the order of effects safe?
6. **Queries** — one query per unit of work, or one per loop turn?
7. **Output** — what leaves the module: contract types or raw rows?

## 1. Imports

Compare each import with the ring table in SKILL §2. Type-only imports count.

## 2. Construction

`new` of an adapter, a repository or an SDK client inside a service or a method is
a finding. So is a service that takes `Container` instead of the few functions it
uses. Construction belongs to the plugin body or the composition root.

## 3. Ports — the method must exist

A service may only call a method that is declared on the port it depends on
(`vendor/shared/adapters.ts`). If the code calls `github.createIssueComment(...)`
and `GitHubClient` has no such method, the code is leaning on a concrete adapter
even when no adapter is imported (it got it from a cast, a wider type or a
`new`). Check by reading the port, not by trusting the call site.

The fix is three edits in this order: add the method to the port (use-case
shaped, no SDK types in the signature) → implement it in the adapter → add it to
the mock in `adapters/mocks.ts`.

## 4. Tenancy

Every repository read of a domain table takes `workspaceId`. Tables without a
`workspace_id` column are scoped through a join (`findings` → `reviews`,
`pr_files` → `pull_requests`). A method that takes only an id is a finding even if
its caller happens to check the workspace first: the check is then an accident of
call order.

## 5. Writes and side effects

Two separate questions:

- **Atomicity.** More than one statement for one use case → one transaction
  (`references/transactions.md`).
- **Order of effects.** When a use case writes, then calls an outside system, then
  writes the result of that call, a failure in the middle leaves a record that
  says something that is not true (a row marked "pending" for ever, or a row
  marked "sent" for a message that was never sent). Decide per step which state is
  safe to leave behind, write a state *before* the call that a retry can pick up
  (`pending`), and make the call safe to repeat (an idempotency key, or a check of
  what was already sent). Never hold a transaction open across the call.

## 6. Queries in loops

A repository call, or a port call that hits the network, inside a `for`, `map` or
`Promise.all` over rows is N+1. Move the loop into the repository: one method that
takes the list of ids and returns everything grouped. A lookup that is the same
for every turn (the list of agents, the repo row) is hoisted out of the loop.
This is a repository concern, so the fix does not change any ring.

## 7. Output

A repository returns contract or domain types when the value leaves it. A route
that returns a row straight from the service has no response schema and leaks
every column, including ones added later. Declare `response: { 200: Schema }` on
the route and map in the repository.

## Reporting

Report findings as `file:line — what — rule`, grouped by the pass above, and say
which findings are blockers (wrong data or a security hole) and which are
structure only. End with the ordered fix plan, each step leaving `pnpm arch:check`
green.

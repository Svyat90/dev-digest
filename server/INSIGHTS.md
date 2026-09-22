# server — insights

Traps found while working here. Newest first, one entry per trap.
Format: date · symptom · cause · rule.

Appended by the `engineering-insights` skill: append-only, never rewritten.

## What Works

Approaches and solutions that held up here.

- **2026-09-19 — Test fire-and-forget review behaviour by INSERTING runs, not by running one.**
  `runReview` returns before any agent finishes, so an integration test that
  drives it can only assert on what is written at CREATION time (ids,
  `round_id`) without a flaky wait. Everything derived from finished runs —
  cost rollups, status derivation — is better tested by inserting `agent_runs`
  rows directly and calling the route: `pulls-cost.it.test.ts` covers six
  branches in ~3s with exact arithmetic and no LLM.
  Rule: split these — creation-time facts in the run-the-review test, derived
  behaviour in a direct-insert `.it.test.ts`.
  `server/test/pulls-cost.it.test.ts`, `server/test/reviews.it.test.ts`

## What Doesn't Work

Dead ends and antipatterns. The most frequently skipped section and the most
valuable one.

- **2026-09-21 — The server has ZERO `db.transaction()` calls; multi-step writes are not atomic.**
  `GET /pulls/:id` refreshes from GitHub by deleting `pr_files`, inserting new rows,
  deleting `pr_commits`, inserting again, then updating `pull_requests` as five
  separate statements inside one `try`. Its `catch` assumes "offline, serve
  persisted detail" — but if a later statement throws, the earlier delete has
  already committed, so it serves a PR with no files or commits.
  Rule: any write that deletes-then-reinserts or touches more than one table goes
  in `container.db.transaction(async (tx) => …)`, and every statement in it uses `tx`.
  `server/src/modules/pulls/routes.ts:264-301` (`grep -rn "\.transaction(" server/src` → empty)
  Confidence: low

- **2026-09-20 — Grepping `pgTable('name'` silently UNDERCOUNTS the schema.**
  The schema files mix two formattings: `pgTable('agents', {` on one line, and
  `pgTable(` with the name on the NEXT line (`pulls.ts`, `repos.ts`, and others).
  `grep -oE "pgTable\(\s*'[a-z_]+'"` therefore returned a table list that was
  missing `pull_requests` and `repos` entirely — with no error, just a shorter
  answer that looked complete. An inventory built on it is wrong in the one way
  nobody double-checks.
  Rule: to enumerate tables, match BOTH shapes (same-line and the line after
  `pgTable(`), or read the barrel `src/db/schema.ts` and each file's exports —
  never trust a single-line grep over this schema.
  `server/src/db/schema/pulls.ts`, `server/src/db/schema/repos.ts`

- **2026-09-19 — The seeded review was invisible to anything that joins reviews to runs.**
  `seed.ts` wrote the demo review with no `run_id` and no `agent_id` (it is
  inserted before any agent exists), while `seedAgentRuns` wrote five unrelated
  `agent_runs`. A timeline feature that matches `RunSummary.run_id` to
  `ReviewRecord.run_id` therefore rendered its fallback branch on every row of a
  freshly seeded DB and looked broken. Fixed by having one seeded run claim the
  review (`ownsSeedReview` → `UPDATE reviews SET run_id, agent_id`).
  Second half of the trap: `seed()` skips the whole PR block once PR #482 exists,
  so editing seeded rows changes NOTHING on an existing dev DB — verify seed
  edits against a fresh database (testcontainers or the hermetic e2e stack).
  Rule: when seeding two tables that a feature joins, seed the link too, and
  never conclude a seed edit works because the dev DB still looks right.
  `server/src/db/seed.ts` (`seedAgentRuns`, `ownsSeedReview`)

- **2026-09-19 — `waitForPrRuns` returns on TIMEOUT, it does not throw.**
  Its doc says it "polls until every row reaches a terminal status", but after
  `timeoutMs` (default 10s) it returns whatever rows exist. A `POST
  /pulls/:id/review` with `{ all: true }` does NOT settle inside that window, so
  assertions silently ran against rows still in `status: 'running'` — the
  failure surfaced far downstream as `expected 1 to be greater than or equal to
  2`, not as a timeout.
  Rule: after `waitForPrRuns`, ASSERT the statuses are terminal before asserting
  on anything the executor writes — or don't depend on completion at all (see
  the paired entry in What Works).
  `server/test/helpers/runs.ts:19-31`

## Codebase Patterns

Conventions and structural decisions a newcomer would otherwise re-derive.

- **2026-09-21 — Half the modules do NOT follow the documented routes → service → repository anatomy.**
  `docs/architecture.md` presents the three-file module as the norm, but only
  `agents`, `repos`, `reviews` and `repo-intel` have it. `pulls` (18
  `container.db` calls), `exports` (4), `polling` (3), `settings` (3) and
  `workspace` (1) query Drizzle straight from `routes.ts` with no service or
  repository — `pulls/routes.ts` is the largest route file at 407 lines.
  Rule: do NOT copy a neighbouring module's shape as "the convention" — new code
  follows the documented anatomy, and edits to those five modules extract into a
  service/repository instead of adding more inline queries.
  `grep -c "container.db" server/src/modules/*/routes.ts`

- **2026-09-19 — `findings` is the ONE domain table with no `workspace_id`.**
  Root `CLAUDE.md` says every domain table carries `workspace_id` and every query
  scopes by it — `findings` does not, and it has no indexes either (not even on
  `review_id`). Tenancy reaches a finding only through its review, so any
  aggregate over findings must `innerJoin(t.reviews, eq(t.reviews.id,
  t.findings.reviewId))` and scope on `t.reviews.workspaceId`. The join is not an
  optimisation, it IS the tenancy boundary.
  Rule: NEVER filter findings by PR id alone — join reviews and assert the
  workspace there, the way the PR-list FINDINGS rollup does.
  `server/src/db/schema/reviews.ts:29-47`, `server/src/modules/pulls/routes.ts` (FINDINGS rollup)

- **2026-09-19 — A run's cost is `null` for "unknown", `0` for "free" — never conflate them.**
  `estimateCost` returns `null` for a model missing from the price table, while
  `z-ai/glm-4.7-flash` is priced at exactly 0. The run-executor failure path sets
  `tokensIn: 0, tokensOut: 0` — copying that symmetry for cost would report a
  failed run as free. Rule: the failure path writes `costUsd: null`, and every
  cost column/field stays nullable so the UI can render an em dash.
  `server/src/modules/reviews/run-executor.ts` (catch block), `server/src/adapters/llm/pricing.ts:37`

- **2026-09-19 — `completeAgentRun`'s value type is declared TWICE.**
  The inline `values` type exists in `repository/run.repo.ts` AND is re-declared
  on the `repository.ts` facade method. Adding a field to only one gives
  `TS2353: 'costUsd' does not exist in type …` at the call site, not at the repo.
  Rule: when extending any repository facade method, patch BOTH declarations.
  `server/src/modules/reviews/repository.ts:151`, `server/src/modules/reviews/repository/run.repo.ts:141`

## Tool & Library Notes

Quirks of the dependencies this package pins.

- **2026-09-21 — `arch:check`'s baseline pins the pnpm store path, so a drizzle bump "creates" violations.**
  `.dependency-cruiser-known-violations.json` records targets as
  `node_modules/.pnpm/drizzle-orm@0.38.4_postgres@3.4.9/node_modules/drizzle-orm/index.d.ts`
  (4 entries). Bumping drizzle-orm or postgres changes that path, so the old
  `routes → drizzle` debt no longer matches and `pnpm run arch:check` fails on a PR
  that touched no import.
  Rule: after a dependency bump, run the full report
  (`pnpm exec depcruise src --config .dependency-cruiser.cjs --output-type err`),
  confirm every "new" violation is a renamed store path of a known one, THEN
  `pnpm run arch:baseline`. Never baseline anything else.
  `server/.dependency-cruiser-known-violations.json`
  Confidence: low

- **2026-09-19 — Drizzle's `count()` is NOT the same hazard as `sum()`: it maps to a number.**
  `sum()` is typed `string | null` and has to go through `parseAggregateCost`
  (see the entry below). `count()` is declared with `.mapWith(Number)` and, over
  a `GROUP BY` whose group exists, is never NULL — Postgres returns 0 rows for an
  empty group rather than a row containing NULL.
  Rule: do NOT wrap `count()` in `parseAggregateCost` "for symmetry" — the null
  it guards against cannot occur, and the wrapper only hides that fact. Decide
  "absent vs zero" in the caller instead (the PR-list rollup gates on whether the
  PR has a review at all).
  `server/src/modules/pulls/routes.ts` (FINDINGS rollup), `server/src/modules/pulls/status.ts`

- **2026-09-19 — Drizzle types `sum()` as `string | null`, even over `doublePrecision`.**
  `aggregate.d.ts` declares `sum(expression): SQL<string | null>` regardless of
  the column type, while postgres.js hands back a real number for
  `double precision` — so an aggregate's value must be coerced accepting BOTH.
  The trap is the null: `Number(null)` is 0, which turns "no price data" into
  "this was free" (the read-path twin of the write-path rule in Codebase
  Patterns). Postgres `sum()` already skips NULLs and yields NULL when none
  remain, so the partial-sum rule needs no JS branches — only the coercion.
  Rule: put every SQL aggregate over a nullable numeric column through
  `parseAggregateCost`, and NEVER shorten it to a bare `Number(...)`.
  `server/src/modules/pulls/status.ts`, `server/src/modules/pulls/routes.ts` (PR-list COST)

## Recurring Errors & Fixes

An error seen twice, plus the fix that actually worked.

## Session Notes

Dated summary, only when a session changed how this package is worked on.

## Open Questions

What was left unresolved, so the next session does not re-investigate blind.

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

## Recurring Errors & Fixes

An error seen twice, plus the fix that actually worked.

## Session Notes

Dated summary, only when a session changed how this package is worked on.

## Open Questions

What was left unresolved, so the next session does not re-investigate blind.

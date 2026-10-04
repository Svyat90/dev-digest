# Cross-model review — PR Brief implementation plan

Date: 2026-10-04 · Plan: [`docs/plans/2026-10-04-pr-brief.md`](../2026-10-04-pr-brief.md) (draft, rev. 1)
· Spec: [`specs/03-pr-brief-2026-10-04.md`](../../../specs/03-pr-brief-2026-10-04.md)

- **Reviewer:** ChatGPT, free tier (OpenAI model family). The plan was written by
  Claude Opus (`implementation-planner`), so this is a review from a different model family.
- **Input:** the plan file only. The spec was not given to the reviewer.
- **Overall verdict:** "very well worked out, ~8/10". No AC is missing. The weak spot
  is consistency and concurrency semantics (two generations, two SHAs, several failing
  dependencies at once), which the plan describes less precisely than the ACs themselves.

## PR note (paste into the PR description)

> **Cross-model review.** The plan (written by Claude Opus) was reviewed by ChatGPT
> (free tier, OpenAI). Verdict ~8/10, no AC uncovered. Main findings: an older-SHA
> generation that finishes last can overwrite a newer brief; the e2e flow never
> exercises Generate → API → UI; all fact-source errors are folded into "missing
> input", which can hide real bugs; the 8,000-token budget is a target, not a hard cap
> (`over_budget` still calls the model); no `duration_ms` in the generation log.
> Several other points were already settled by the spec (stale GET semantics,
> "one answered attempt"). See `docs/plans/reviews/2026-10-04-pr-brief-cross-model-review.md`.

## Findings, checked against the plan and the spec

Status: **covered** — already settled by the spec or plan, no change · **valid** — a
real gap, worth a plan change · **decide** — the fix changes an accepted spec decision.

### High

| # | Finding | Status | Evidence / proposed action |
|---|---|---|---|
| H1 | Two generations for different head SHAs: the older one finishing last overwrites the newer brief (`pr_brief` upsert is unconditional). | **decide** | Spec AC18 + accepted OQ16 say "the last finished generation is stored" (EC13). A guard "never replace a brief whose `head_sha` is the PR's current head with one that is not" is safer, but changes that decision. Plan: T010 single `onConflictDoUpdate` (plan line ~517). |
| H2 | No integration test for concurrent generations with different SHAs. | **valid** (follows H1) | Add with the H1 guard, if accepted. |
| H3 | The e2e flow never presses Generate brief, so POST → loading → success → stale → refresh → navigation is never tested end to end. | **valid** | T015 is read-only by design (no model in e2e); R3 (seeded brief) was rejected. Option: an e2e-only mock LLM provider, or re-accept R3 for the navigation half. |
| H4 | `GET` may return a stale brief without defined server semantics. | **covered** | AC19 + AC20: GET returns the last successful brief; the client marks it out of date by comparing `head_sha` (plan T012). |
| H5 | `maxRetries: 0` does not guarantee one HTTP request. | **covered** | AC2 says "one answered attempt"; transport retries allowed by user answer OQ20; `server/INSIGHTS.md` 2026-10-04. |

### Medium

| # | Finding | Status | Evidence / proposed action |
|---|---|---|---|
| M1 | Every fact-source error becomes a "missing input", so a bug in, e.g., `resolveDocs` looks like "no documents". | **valid** | Plan T010 rule "every fact source is best-effort" (line ~519). Split: expected absence → missing input; timeout / dependency unavailable → missing input + logged `degraded` reason; unexpected error → logged at error level (still not failing, per AC9). |
| M2 | No source → error → outcome matrix (timeout, 404/403/500 issue, document failure, blast degraded, smart-diff failure). | **valid** | Add a table to T010 so the implementer and tests share one definition. |
| M3 | The budget is a target: after all trimming steps the call still runs with `over_budget: true`. | **valid** | Plan A4 vs spec AC5 ("shorten … until it fits"). Add a final hard step (e.g. drop documents entirely, then cut the file list to N) so the model never gets > 8,000 tokens. |
| M4 | No `duration_ms` in the generation log. | **valid** | Cheap: add to the T010 log record next to `cost_usd`. |
| M5 | `cost_usd` may miss billed transport retries. | **covered** | `costUsd = estimateCost(model, tokensIn, tokensOut)` from the answered response (`server/src/adapters/llm/openai.ts:84`); a request with no answer reports no tokens. |
| M6 | No test "generate at SHA A → PR moves to SHA B → GET shows the old brief as stale". | **valid** (small) | Client side is tested (T012); add a server integration case to T013. |
| M7 | The diff can change between generation and click (line gone, file renamed). | **covered** | AC16 / EC15 / EC17: file header + notice when the line or file is not found. |
| M8 | Facts may come from different moments (persisted files vs intent vs blast index). | **valid** (doc only) | State the consistency boundary in T010: the brief describes the PR row loaded at the start; `head_sha` is that row's; stale intent is labelled (A1). |

### Low

| # | Finding | Status | Evidence / proposed action |
|---|---|---|---|
| L1 | e2e depends on PR #482 existing in the hermetic seed. | **covered** | Same fixture as existing e2e flow 08 (plan T015). |
| L2 | No keyboard test for focus → Enter → Files changed → target. | **valid** (small) | Refs are `<button>`s (T012); add one `userEvent.keyboard('{Enter}')` case. |
| L3 | No cap on the number of documents read before trimming. | **valid** (small) | Add a max document count (e.g. 20) before budgeting. |
| L4 | Up to 3 issue fetches could run sequentially (≈15 s worst case). | **valid** (small) | Require them to run in parallel under one overall deadline in T010. |
| L5 | "One manual generation with a real key" is a weak release gate for schema compatibility. | **valid** (deferred) | Keep the manual check for the demo; a provider contract test is a follow-up. |

## Reviewer's top 5 before implementation

1. Protect against an older generation overwriting a newer one (H1) — **needs a decision**.
2. Define stale GET semantics (H4) — already in the spec.
3. Define "one model call" as one answered attempt (H5) — already in the spec.
4. Separate expected missing data from infrastructure failures (M1, M2).
5. Add a real Generate → API → UI → navigation e2e test (H3).

## Decisions (user, 2026-10-04)

- **Applied to the plan (planner revision 2):** M1 + M2 (source → error → outcome
  matrix; unexpected errors logged, not hidden), M3 (hard 8,000-token cap), M4
  (`duration_ms`), M6 (stale-GET integration case), M8 (consistency boundary), L2
  (keyboard test), L3 (document count cap), L4 (parallel issue fetches, one deadline).
- **Kept as is, follow-up:** H1/H2. AC18 and OQ16 ("the last finished generation is
  stored") stay. A brief from an older SHA is still shown as out of date (AC20). A
  newest-SHA-wins guard needs a superseding spec.
- **Not applied:** H3 (e2e with a mock LLM) and L5 (provider contract test). The
  generation flow is covered by service, route and component tests, and a manual run
  with a real key before the demo.
- **Already covered, no change:** H4, H5, M5, M7, L1.

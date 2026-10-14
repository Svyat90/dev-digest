# spec — eval dashboard

The Eval Dashboard reads the run records that the eval pipeline writes
([`evals.md`](evals.md)) and answers three questions: how is each agent doing,
what changed between two runs, and can I make an old run's configuration the
agent's current one. This file is the **contract of the shipped server
behaviour**: the invariants below are what the client and the integration tests
build on, so changing one is a breaking change, not a refactor.

It does **not** restate acceptance criteria. Requirements live in the root spec,
which stays the single source of truth:

- [`../../specs/05-eval-dashboard-2026-10-11.md`](../../specs/05-eval-dashboard-2026-10-11.md)
  (SPEC-05, dashboards, alert, compare, Promote, Run all agents).
- The case-set rule (an edited case counts as one removed and one added) comes
  from SPEC-06 AC12 in
  [`../../specs/06-case-editor-2026-10-12.md`](../../specs/06-case-editor-2026-10-12.md).

Design history: [`../../docs/plans/2026-10-12-eval-dashboard.md`](../../docs/plans/2026-10-12-eval-dashboard.md).
The run records, metrics and run lifecycle are defined in [`evals.md`](evals.md)
and are not repeated here.

Code: `src/modules/eval-dashboard/` (`routes.ts` → `service.ts` →
`repository/dashboard.repo.ts` and `repository/promotion.repo.ts`; row mapper in
`helpers.ts`, structural ports in `types.ts`), pure rules in
`src/domain/evals/{dashboard,compare,promote}.ts`, the shared start limit in
`src/platform/run-start-limiter.ts` and `src/modules/_shared/run-start-guard.ts`.

## Endpoints

All routes are workspace-scoped (ED12). Source:
`src/modules/eval-dashboard/routes.ts`.

| Method | Path | Success | Notes |
|---|---|---|---|
| GET | `/eval-dashboard` | 200 `EvalWorkspaceDashboard`: one row per agent plus the recent runs | |
| POST | `/eval-dashboard/run-all` | 202 `{ started, skipped }` | counts once against the shared start limit (ED8); 429 `run_start_rate_limited` |
| GET | `/agents/:id/eval-dashboard?range=` | 200 `EvalDashboard` | `range` is `7d`, `30d` (default), `90d` or `all`; an unknown agent is 404 |
| GET | `/agents/:id/eval-runs/compare?a=&b=` | 200 `EvalRunComparison` | 404 unknown run or agent; 422 `validation_error` when `a` equals `b`; 422 `eval_run_not_completed` |
| POST | `/agents/:id/eval-runs/:runId/promote` | 200 `PromoteEvalRunResponse` | 404; 422 `eval_run_not_completed`; 409 `eval_promote_noop` |

The route `POST /agents/:id/eval-runs` (start one run) belongs to the evals
module and uses the same start guard (ED8).

## Invariants

| # | Rule |
|---|---|
| ED1 | **The headline numbers ignore the range.** `latest` and `previous` are the two newest `completed` runs of the agent (`lastCompletedRuns(…, 2)`), and the regression alert is built from exactly those two, whatever `range` says. The range filters only `trend` and `runs`. |
| ED2 | **Trend.** `trend` holds the `completed` runs of the range, at most 200 (`TREND_POINT_CAP`): the 200 newest, returned oldest first. The repository reads 201 rows so `trend_truncated` is true exactly when more than 200 exist. |
| ED3 | **Run lists.** `runs` on the agent dashboard holds every run of the range in every status, newest first, without paging. `recent_runs` on the workspace dashboard holds the 20 newest runs of the workspace in every status (`RECENT_RUNS_LIMIT`), each with its agent name. A `running` run is returned separately as `running_run`, whatever the range. |
| ED4 | **Regression alert.** Metrics are compared in whole percent points (`round(value × 100)`). A metric counts only when it has a value in both of the two newest completed runs. The alert fires when some metric dropped by at least 1 point; the largest drop wins and a tie goes in the order recall, precision, citation accuracy. It reports `drop_points` as a positive number. Every other compared metric is reported as `up`, `down` or `same` by the same whole-point rule; a metric with no value in either run is left out. With no completed run, one run, or no drop, `alert` is `null`. |
| ED5 | **Case sets compare by revision id.** `case_sets` is `{ added, removed }` over `eval_suite_runs.cases` keyed by `revision_id`. A case present in both runs at different revisions counts as one removed and one added. The alert and Compare use the same function (`caseSetDiff`). |
| ED6 | **Workspace dashboard rows.** One row per agent of the workspace, ordered by name, whether the agent is enabled or not: `cases_total` (agent-owned cases), `running`, the agent's `latest` completed run (or `null`) and `recall_trend`, the recall of its completed runs started in the last 30 days, oldest first, with unknown recalls left out. Each read is one grouped query, never one per agent. |
| ED7 | **Run all agents.** One `startRun` call (SPEC-04) per eligible agent, in agent-name order. An agent with no eval cases is skipped as `no_eval_cases`; an agent with a `running` run is skipped as `eval_run_in_progress`. The same two codes are also treated as skips when `startRun` itself refuses with them (a start that raced). An agent that disappears during the loop (404) is in neither list. Any other failure is logged (agent id and error message only) and the agent is in neither list. The route answers 202. |
| ED8 | **One shared run-start limit.** At most 10 eval run starts per minute per workspace (`RUN_START_LIMIT`), counted by one `RunStartLimiter` held by the container (`container.runStartLimiter`) behind the `runStartGuard` preHandler. `POST /agents/:id/eval-runs` and `POST /eval-dashboard/run-all` both use the guard, and no eval run-start route has a route-level `rateLimit` of its own. A run-all request costs 1 however many agents it starts. A refused request (429 `run_start_rate_limited`, `details.retry_after_ms`) costs nothing, and runs before the handler, so it starts nothing and makes no model call. The window is a fixed 60 seconds that opens at the first counted start; counts live in memory, reset on restart, and assume one API instance per database ([`review-flow.md`](review-flow.md) invariant 5). Under `nodeEnv === 'test'` the default limiter is unlimited; tests inject a `RunStartLimiter` through `ContainerOverrides.runStartLimiter`. Any later run-start route (SPEC-06's single-case and skill runs) joins the same counter by adding `preHandler: runStartGuard(container)`. |
| ED9 | **Compare.** Both runs must exist for the agent and be `completed`. The result is ordered earlier then later by `started_at` whatever the argument order (equal times fall back to the run id). `config_changes` lists provider, model and strategy when they differ. `skill_changes` lists a skill that is `added`, `removed` or `version_changed`; order changes and link-enabled changes are not listed. A skill body comes from `skill_versions` by `(skill_id, version)`, falling back to the body recorded on the run, and is `null` when neither exists. |
| ED10 | **Promote preview is part of Compare.** `promote` describes promoting the **later** run: `is_current`, `skills_to_restore` (current and recorded version), `affected_agents` (other agents of the workspace that link a skill to restore, in any link state, by name) and `deleted_skills`. `is_current` is true when the agent's provider, model, system prompt and strategy equal the record, its links equal the record's still-existing skills in recorded order with their recorded link flags, and no skill body would be restored. A skill's own `enabled` flag, name and description are not compared. |
| ED11 | **Promote is one transaction and append-only.** `applyPromotion` runs one `db.transaction` over `skills`, `skill_versions`, `agents`, `agent_skills` and `agent_versions`. For each skill whose recorded body differs from its current body: the skill's `version` is incremented, its body replaced and a `skill_versions` row written with the note `Restored from v<recorded> by Promote`. The agent's provider, model, system prompt and strategy are set from the record and its `version` is incremented; its links are replaced by the record's still-existing skills in recorded order with their recorded link flags; an `agent_versions` row is written. A recorded skill that no longer exists is left out. Promote never changes a skill's `enabled` flag, name, description or type, nor the agent's name, description, output schema, CI gate, repo-intel flag or enabled state. No version row is updated or deleted; a version-key conflict throws and rolls everything back. When nothing would change, Promote writes nothing and answers 409 `eval_promote_noop`. |
| ED12 | **Tenancy.** Every read and write filters on `workspace_id`. A run is additionally read by `agent_id`, so another agent's or another workspace's run id answers 404 and writes nothing. Skill bodies are read through a join on `skills.workspace_id`. |
| ED13 | **No model call anywhere.** The service receives no LLM provider; the only way to start work is the structural port `EvalRunStarter` (`container.evals.startRun`) used by Run all. The rules in `domain/evals/{dashboard,compare,promote}.ts` are pure, so `arch:check` proves they cannot reach a model. |
| ED14 | **Cost `null` means unknown, never `0`.** Run records pass `cost_usd` through unchanged, as in [`evals.md`](evals.md) EV11. |

## Data model

No tables of its own and no migration. The module reads `eval_suite_runs`,
`eval_cases`, `agents`, `skills`, `skill_versions`, `agent_skills` and
`agent_versions` (schemas in [`evals.md`](evals.md) and
[`skills.md`](skills.md)). The only writes are the Promote transaction (ED11).
`agent_versions.config_json` is typed `satisfies AgentVersionConfig`, so a
contract change breaks the Promote write at compile time.

## Contracts

The dashboard schemas live in the eval section of
`src/vendor/shared/contracts/eval-ci.ts` (canonical) and are mirrored in
`client/src/vendor/shared/contracts/eval-ci.ts`: `EvalDashboardRange`,
`EvalRegressionAlert`, `EvalTrendPoint`, `EvalDashboard`,
`EvalWorkspaceDashboard`, `RunAllEvalsResponse`, `EvalRunComparison`,
`PromoteEvalRunResponse`. `EvalErrorCode` gained `eval_run_not_completed` and
`eval_promote_noop`; `run_start_rate_limited` is not an `EvalErrorCode`, it
travels only in the `AppError` envelope.

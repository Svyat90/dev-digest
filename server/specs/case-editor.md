# spec — case editor, single-case runs and skill evals

You write an eval case by hand, edit it as new revisions, run one case as a
scratch check, and give a skill its own case set that runs through an agent you
pick. This file is the **contract of the shipped server behaviour**. The client,
the integration tests and the e2e flow `10-case-editor` build on the invariants
below, so changing one is a breaking change, not a refactor.

It does **not** restate acceptance criteria. The requirements live in the root
spec, which stays the single source of truth:

- [`../../specs/06-case-editor-2026-10-12.md`](../../specs/06-case-editor-2026-10-12.md)
  (SPEC-06, the case editor and the skills' Evals tab).

It builds on [`evals.md`](evals.md) (SPEC-04: case storage, revisions, runs,
scoring, EV1–EV17) and [`eval-dashboard.md`](eval-dashboard.md) (SPEC-05: the
dashboards, compare, the shared run-start limit, ED1–ED14). The skill side is
also recorded as S11 in [`skills.md`](skills.md).

Design history: [`../../docs/plans/2026-10-12-case-editor.md`](../../docs/plans/2026-10-12-case-editor.md).
Code:

- `src/modules/evals/` holds the routes in `routes.ts` and the editor use cases
  in `case-service.ts`. Skill runs and the remembered agent are in `service.ts`.
  Per-case execution is shared through `run-executor.ts`. Data access is in
  `repository/case.repo.ts` and `repository/skill-eval.repo.ts`.
- `src/domain/evals/case-editor.ts` and `src/domain/evals/run-owner.ts` hold
  the pure rules.
- `src/vendor/shared/contracts/eval-case.ts` holds the shared validation code.
- `src/adapters/git/diff-parser.ts` is the engine diff parser.
- `src/db/schema/eval.ts` is the schema.

## Endpoints

`:id` is the owner id (agent or skill). Every route is scoped to the caller's
workspace and, where it names one, to the owner (CE16). Source:
`src/modules/evals/routes.ts`.

| Method | Path | Success | Refusals |
|---|---|---|---|
| GET | `/agents/:id/eval-cases` · `/skills/:id/eval-cases` | 200 `EvalCaseListItem[]`, oldest first | 404 unknown owner |
| POST | `/agents/:id/eval-cases` · `/skills/:id/eval-cases` (body `EvalCaseDraft`) | 201 `SaveEvalCaseResponse`, `revision_created: true` | 404 unknown owner; 422 `eval_case_invalid` with `details.issues` (a name clash included, CE4) |
| GET | `…/eval-cases/:caseId` | 200 `EvalCaseDetail` | 404 unknown owner or case |
| PUT | `…/eval-cases/:caseId` (body `EvalCaseDraft`) | 200 `SaveEvalCaseResponse` | 404; 422 `eval_case_invalid` / `eval_case_content_fixed`; 409 `eval_case_edit_conflict` |
| POST | `…/eval-cases/:caseId/check` (no body) | 202 `{ check_id }`; the check continues in the background | 404; 409 `eval_case_check_in_progress`; 422 `eval_agent_required` / `eval_agent_missing` (skill cases); 429 `run_start_rate_limited` |
| GET | `/skills/:id/eval-agent` | 200 `SkillEvalAgent` | 404 unknown skill |
| PUT | `/skills/:id/eval-agent` (body `{ agent_id }`) | 200 `SkillEvalAgent` | 404 unknown skill or agent |
| POST | `/skills/:id/eval-runs` (no body) | 202 `{ run_id }`; the run continues in the background | 404; 422 `eval_agent_required` / `eval_agent_missing` / `no_eval_cases`; 409 `eval_run_in_progress`; 429 `run_start_rate_limited` |
| GET | `/skills/:id/eval-runs` | 200 `SkillEvalRunSummary[]`, newest first | 404 unknown skill |
| GET | `/eval-runs/:id` (`:id` is the run id) | 200 `EvalRunDetail`, a union tagged by `owner_kind` (`agent` or `skill`) | 404 unknown run or another workspace's run |

A skill case is deleted through SPEC-04's `DELETE /eval-cases/:id` (see
[`evals.md`](evals.md)). The 409 / 422 split of the `EvalErrorCode` refusals
is in `service.ts:75-84`: `eval_run_in_progress`, `eval_case_edit_conflict` and
`eval_case_check_in_progress` are 409, and every other code is 422. A body that
fails the route's zod schema is a 422 before the handler runs.

## Invariants

| # | Rule |
|---|---|
| CE1 | **One validation, two places.** `validateCaseDraft` in `vendor/shared/contracts/eval-case.ts` is the only rule set. The editor runs it on the debounced draft while you type (300 ms) and the service runs it again on every create and every save. The file is byte-identical in `server/src/vendor/shared` and `client/src/vendor/shared` and imports only zod and its sibling contract. It reports at most one issue per field, in the order `name`, `input_diff`, `pr_title`, `pr_description`, `expectation`, `expected_output`. |
| CE2 | **Limits and field rules.** Name: required, at most 60 characters, only `[a-z0-9-]`, and not taken by another case of the set. Diff: required, at most 100 000 characters. PR title: at most 300 characters. PR description: at most 4 000 characters. Expectation: the file is a file of the diff, `start_line` ≥ 1, `start_line` ≤ `end_line`, and the range intersects a new-side hunk range of that file. The expectation is checked only when the diff has no issue. Expected output: at most 20 000 characters, valid JSON, an array. A `must_not_flag` case needs `[]`. A `must_find` case needs exactly one object with the keys `severity`, `category`, `title`, `file`, `start_line` and an optional `end_line`, and no other key. The title is 1–200 characters. `file`, `start_line` and (when present) `end_line` must equal the expectation. Each failure is one closed `EvalCaseIssueCode`. |
| CE3 | **Strict diff parsing.** `parseCaseDiff` splits on `\n`, drops a trailing `\r` and ignores trailing empty lines. Outside a hunk, only file-header lines are allowed (`diff --git `, `index `, `--- `, `+++ `, file mode, similarity, rename, copy and `Binary files ` lines). A hunk header (`@@ -a[,b] +c[,d] @@`) needs a preceding `+++ ` line. Inside a hunk, a ` `, `+`, `-` or empty line counts against the header's counts, and a `\` line is not counted. A non-header line outside a hunk is `diff_stray_line` at that line. A body that disagrees with the header counts is `diff_hunk_count_mismatch` at the hunk header's line. No hunk is `diff_no_hunk`. Parsing stops at the first issue. Line numbers are 1-based lines of the pasted text. The file path comes from `+++ b/<p>`, or from `--- a/<p>` when the new side is `/dev/null`. |
| CE4 | **Case names are unique per set.** The service checks the draft name against the other names of the owner's set before any write, and answers 422 `eval_case_invalid` with `{ field: 'name', code: 'name_taken' }`. The guarantee is SPEC-04's unique index `eval_cases_owner_name_uq` over `(workspace_id, owner_kind, owner_id, name)` (EV3). A clash the service could not see, such as two concurrent saves, fails on that index. The case + revision transaction rolls back, nothing is written, and the same `name_taken` refusal is answered, never a 500. |
| CE5 | **A manual case is stored exactly as entered.** Create writes the case and its revision 1 in one transaction. The revision holds the pasted diff, the files parsed from it, the PR title and description, the expectation and the parsed expected output (`expected_output` jsonb). `owner_kind` / `owner_id` name the owner. `agent_id` is set for an agent's case and `skill_id` for a skill's case. A manual case has no `provenance` (`origin: 'manual'`). |
| CE6 | **Edits append revisions.** A save whose content differs from the current revision appends revision N+1 in the same transaction as the name update, and answers `revision_created: true`. Content means the diff, the PR title and description, the expectation type, file and lines, and the expected output. The expected output is compared with its object keys sorted, so key order alone is not a change. A name-only save writes no revision and answers `revision_created: false`. A second revision written concurrently fails on `UNIQUE (case_id, revision)` and answers 409 `eval_case_edit_conflict`, with nothing written. |
| CE7 | **Finding-made cases are fixed.** A case made from a finding (SPEC-04, `origin: 'finding'`) may change only its name. Any content change answers 422 `eval_case_content_fixed`. Only the name rules of CE2 are applied to it. It stores no expected output. The API shows `[]` for `must_not_flag`, or one finding built from its provenance (severity, category, title) and expectation for `must_find`. |
| CE8 | **Engine and editor number lines alike.** The engine diff parser (`parseUnifiedDiff`) skips a `\ No newline at end of file` line inside a hunk. It gets no new-side number and does not move the cursor, so the lines a case is graded against are the lines the editor showed. The parser's other leniencies are unchanged. Stored reviews are not re-grounded. |
| CE9 | **Runs record revisions; compare counts edits.** Every full run and skill run records each covered case's `(case_id, revision_id, revision)` (EV6). Compare and the regression alert key the case set by `revision_id` (ED5), so a case edited between two runs counts as one removed and one added. A case row reads "edited since last run" when its latest result's `case_revision_id` is not its current revision. |
| CE10 | **A single-case run is a scratch result.** `POST …/check` writes only `eval_case_checks`, never `eval_suite_runs` or `eval_runs`. It therefore never appears in run history, metrics, trend, alert, compare or the dashboards. One row is kept per revision: a new check of a revision resets that revision's finished row, so the newest result wins. A case has at most one `running` check (`eval_case_checks_one_running_uq`), so a second start answers 409 `eval_case_check_in_progress`. The check uses the same per-case execution as a full run (`runCaseReview`: 180 s timeout, never throws). A failure is stored as `errored` with the reason and an unknown (`null`) cost. On boot, every check left `running` is closed as `errored` with the reason "interrupted by a server restart". A failure to reap is logged and never stops boot. |
| CE11 | **The last-run strip.** `EvalCaseDetail.last_run` is the newer, by finish time, of two candidates. The first is the current revision's finished check. The second is the case's result in the owner's latest completed run, but only when that result covered the current revision. With neither, it is `null`. A running check is not a candidate. The case list's `check` is the current revision's check, and its `latest_result` stays the latest completed run's result. |
| CE12 | **Skill cases run through a remembered agent.** A skill owns its own case set (`owner_kind = 'skill'`). Its runs and single-case runs use the agent stored in `skill_eval_agents` (`PUT /skills/:id/eval-agent`, which must name an agent of the workspace). The agent stays remembered until it is changed. With no agent chosen, the answer is 422 `eval_agent_required`. When the agent was deleted, the answer is 422 `eval_agent_missing` with `details.agent_name`. These refusals are thrown before any write or model call. |
| CE13 | **The skill is on for that run only.** A skill run takes the agent's configuration and puts the measured skill in it, with both enable flags on and its current body, whatever the skill's own `enabled` flag. It keeps the skill's linked position, or places it after the other skills when the skill is not linked. This change lives only in the run's `config`: `agent_skills` and the agent row are never written. The run records `skill_id`, `skill_version`, the via agent (`via_agent_id`, `agent_name`) and `agent_version`. |
| CE14 | **Skill runs stay on the skill's tab.** A skill run is an `eval_suite_runs` row with `agent_id` NULL and `skill_id` set. Every agent-run read (the agent's run list and latest results, both dashboards, compare and Promote) filters `agent_id IS NOT NULL`, or reads by `agent_id` and excludes `skill_id`. A skill run therefore never reaches an agent view or a dashboard. The only owner-neutral read is `GET /eval-runs/:id`, which answers `owner_kind: 'skill'` with the skill fields and the via agent (`agent_id` null and `agent_deleted: true` once that agent is gone). A skill has at most one `running` run (`eval_suite_runs_one_running_skill_uq`). This index does not collide with the via agent's own runs, because skill runs have `agent_id` NULL. Skill runs are reaped on boot like agent runs (EV14). |
| CE15 | **Deletion.** Deleting a skill cascades to its cases, their revisions and checks, its runs and their per-case rows, and its remembered agent. Deleting an agent cascades to its own cases and runs (SPEC-04), but skill runs that went through it are kept: `via_agent_id` becomes NULL and `agent_name` stays. The remembered agent row also keeps `agent_name` with `agent_id` NULL, which the API reports as `missing_agent_name`. |
| CE16 | **Scoping.** Every route checks that the owner exists in the caller's workspace before any validation, write or model call, and answers 404 otherwise. Case reads filter by `workspace_id`, `owner_kind`, `owner_id` and the owner's FK column, so an agent's route never sees a skill's case and the reverse. `GET /eval-runs/:id` is scoped to the workspace only, because its path names no owner. The boot reapers are the only unscoped reads, by design. |
| CE17 | **One shared start limit.** The check route and `POST /skills/:id/eval-runs` carry `preHandler: runStartGuard(container)`, so they count against the same 10 starts per minute per workspace as every other eval run start (ED8). A refused start answers 429 `run_start_rate_limited` with `details.retry_after_ms` and starts nothing. No eval run-start route has a route-level `rateLimit`. |
| CE18 | **What the model receives.** A case reaches the engine only as its stored diff (through the engine parser), a task line built from its PR title, and its PR description (left out when empty), all through the engine's untrusted slots (EV8). The case name, notes and expected output are never sent. Scoring stays code-only (EV9) and ignores the expected finding's severity, category and title. |
| CE19 | **No case content in logs.** The case editor's log lines carry ids, a status and an error reason of at most 200 characters (`errorReason`), never a diff, an expected output, a case name or notes. Cost `null` means unknown, never `0` (EV11), for checks too. |

## Data model

Migration `0019` (drizzle-kit generated, never hand-edited) adds to
`src/db/schema/eval.ts`:

- **`eval_cases`**: `skill_id` (nullable FK → `skills`, cascade; set on skill
  cases), index `eval_cases_ws_skill_idx (workspace_id, skill_id)`. Name
  uniqueness stays SPEC-04's `eval_cases_owner_name_uq`.
- **`eval_case_revisions`**: `expected_output` jsonb (nullable; `null` on
  finding-made revisions).
- **`eval_suite_runs`**: `agent_id` is now nullable (NULL on skill runs). New
  columns are `skill_id` (FK → `skills`, cascade), `skill_version`,
  `via_agent_id` (FK → `agents`, `SET NULL`) and `agent_name`. New indexes are
  `eval_suite_runs_skill_started_idx`, the partial unique
  `eval_suite_runs_one_running_skill_uq (skill_id) WHERE status = 'running'`
  and `eval_suite_runs_via_agent_idx`.
- **`eval_case_checks`** (new, single-case results): `id`, `workspace_id`,
  `case_id` (FK, cascade), `case_revision_id` (FK, cascade), `status`
  (`running` | `passed` | `failed` | `errored`, an enum hint with no CHECK
  constraint), `started_at`, `finished_at`, `duration_ms`, `expected`, `got`,
  `error`, `cost_usd` (`null` = unknown), `findings_returned`,
  `findings_grounded`, `findings_matching`. Indexes:
  `eval_case_checks_revision_uq (case_revision_id)` (the upsert target),
  `eval_case_checks_case_idx`, the partial unique
  `eval_case_checks_one_running_uq (case_id) WHERE status = 'running'`, and
  `eval_case_checks_ws_idx`.
- **`skill_eval_agents`** (new, the remembered agent): `skill_id` (PK, FK →
  `skills`, cascade), `workspace_id`, `agent_id` (nullable FK → `agents`,
  `SET NULL`), `agent_name` (kept after the agent is deleted), `updated_at`.

### Contracts

The canonical contracts are the case-editor section of
`src/vendor/shared/contracts/eval-ci.ts` (`EvalCaseOwner`,
`EvalExpectedFinding`, `EvalCaseCheck`, `EvalCaseLastRun`, `EvalCaseListItem`,
`EvalCaseDetail`, `SaveEvalCaseResponse`, `SkillEvalAgent`,
`SkillEvalRunSummary`, `SkillEvalRunDetail`, `EvalRunDetail`, and the six new
`EvalErrorCode` values) and all of `src/vendor/shared/contracts/eval-case.ts`.
`AgentEvalCase` keeps its SPEC-04 name but describes a case of either owner:
`agent_id` is null for a skill case and `provenance` is null for a manual case.
`EvalRunDetail` is a `z.discriminatedUnion` on `owner_kind`. `eval-case.ts` is
byte-identical in the client copy, and so is the eval section of `eval-ci.ts`.
The client copy of `eval-ci.ts` differs only outside that section (its
`knowledge.js` import line, the missing `AgentManifest` and a narrower
`provider` enum near the end of the file). Root `INSIGHTS.md`,
2026-09-19, covers that drift.

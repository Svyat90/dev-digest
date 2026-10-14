# Case Editor, single-case runs and the skills' Evals tab — Implementation Plan

Date: 2026-10-12 (revised 2026-10-13) · Branch: feature/l06-eval-pipeline-dashboard-case-editor · Status: approved

## Goal
An agent or skill author writes an eval case by hand: pastes a diff fragment, picks `must_find` or `must_not_flag`, a file and a line range, and the expected finding, with every rule checked while typing and again on the server. Editing a case's content stores a new revision, so earlier runs keep their meaning. One case can be run on demand (or on save) as a scratch check that never enters run history. A skill gets its own Evals tab with its own case set, run through an agent the user picks and remembers, with the skill and agent versions recorded on every run.

## Context
- Request: plan every AC (AC1–AC25) of SPEC-06-case-editor (`specs/06-case-editor-2026-10-12.md`, `Status: approved`, `## Open questions: none`; packages server + client) ON TOP of two plans that run first, in this order: `docs/plans/2026-10-11-eval-pipeline.md` (the SPEC-04 plan) and `docs/plans/2026-10-12-eval-dashboard.md` (the SPEC-05 plan). Both are now `Status: done` on this branch (checked 2026-10-13). Their Design, Database and Contracts are shipped: `eval_cases` (identity) + append-only `eval_case_revisions` (UNIQUE `case_id, revision`, current = highest), the full unique index `eval_cases_owner_name_uq (workspace_id, owner_kind, owner_id, name)` with the `-2`, `-3`, … suffix rule for finding-made names (SPEC-04 plan T002, T004, T009), `eval_suite_runs` with `config` and the `cases` jsonb list of `EvalRunCaseRef`, per-case rows in `eval_runs` with `case_revision_id`, migrations 0017/0018 (SPEC-05 adds none, so this plan's migration is 0019), the `evals` module (`EvalService`, `EvalRepository`, `container.evals`, `evals/routes.ts`), the `eval-dashboard` module, `runStartGuard(container)` in `server/src/modules/_shared/run-start-guard.ts` over `RunStartLimiter` (10 starts / min / workspace), the client hooks `client/src/lib/hooks/evals.ts`, the agent editor `EvalsTab` folder, `client/src/lib/eval-metrics.ts`. A file one of those plans created is marked "(new by the SPEC-0x plan T0nn; modified here)".
- After this plan was first written, commit `c7fd204` (2026-10-13) restyled the agent Evals tab and added `client/src/components/eval-ui/` (`MetricTile`, `MetricBar`, `RunStatus`, `evalUi`). T011 moves the restyled files as they are; nothing in this plan edits `eval-ui`.
- User decisions already in the spec (caller, 2026-10-12): content edit = new revision, name-only edit = none; single-case run is a scratch result (newest per case revision, never in history, metrics, trend, alert or dashboards); skill runs go through an agent remembered per skill, shown as "via <agent>" with "Change agent"; skill runs show only on the skill's own Evals tab; all 13 spec assumptions accepted (Run on save off by default and remembered per browser, …).
- Standing decisions (caller): errored cases show the reason instead of numbers; unknown cost is an em dash, never $0; refusals show on the component AND through the global toast (the global error handler is unchanged); execution mode will be multi-agent; out-of-scope extras go to recommendations only; contract changes open and update BOTH `vendor/shared` copies; a last-wave doc-writer task MUST update the package specs in `server/specs/` and `client/specs/` with file names no other plan owns (`server/specs/evals.md` is the SPEC-04 plan's, `server/specs/eval-dashboard.md` the SPEC-05 plan's) → T021.
- Revision 2026-10-12 (cross-spec review, user accepted R2 and R3 of this plan):
  - R2 — unique case names. The suffix rule and the unique index went into the SPEC-04 plan, where finding-made cases and their names are first created (SPEC-04 AC5 now ends "… ending in `-2`, `-3`, … within those 60 characters when that name is already taken in the agent's set, so that no two cases of one set share a name"). Here A1 is rewritten to the new reality: the service checks names for a friendly reason, the index is the guarantee, and a clash the service could not see (a concurrent save) answers the same AC8 refusal (T001, T006, T012, T016).
  - R3 — the engine diff parser `server/src/adapters/git/diff-parser.ts` skips `\ No newline at end of file` lines instead of counting them as context, so its new-side line numbers match the strict editor parser (A2) → new task T022 in Wave 1, before the tasks whose tests depend on matching numbers (T016, T019). It touches the review path for every run.
  - Spec text changed the same day: SPEC-06 NFR Sizes now says the 300-character PR title is "a limit new to this spec (SPEC-04 caps no frozen title)". This plan did not quote the old Sizes text; `EVAL_CASE_LIMITS.prTitleChars = 300` already applies to the editor only, and finding-made cases keep their SPEC-04 title uncapped (they are read-only, A4). No quote needed updating.
- Revision 2026-10-13 (user accepted R1, R4 and R5 of this plan):
  - R1 — one deterministic e2e flow over the new journey: agent editor → Evals → New eval case → paste a valid diff → Save → the row reads "never run", one `e2e/specs/*.flow.json`, no model → new task T025 (Wave 4), plus the accessible names it needs pinned in T010 and T014. It is the first flow that writes (one case in the ephemeral hermetic DB), an exception to `e2e/docs/coverage-spec.md` rule 1 that T025 records in that file (A16).
  - R4 — `GET /eval-runs/:id` serves skill runs too, with their skill and via-agent fields → a discriminated-union contract `EvalRunDetail` in both `eval-ci.ts` copies (T001, byte-identical eval section), the SPEC-04 `getRun` mapper widened by owner and the shared `toSkillRunSummary` mapper (T007) → new task T023 (Wave 4). A9 is rewritten.
  - R5 — the metric helpers duplicated between the moved `client/src/components/eval-suite/helpers.ts` and `client/src/lib/eval-metrics.ts` (`toPercent`, `formatPercent`, `deltaPoints`, plus `formatDelta` ≈ `signedNumber`) get one home, `client/src/lib/eval-metrics.ts` → new task T024 (Wave 2, after T011's move). This also closes the SPEC-05 plan's open R3. A17 settles the one visible change.
- INSIGHTS entries that apply (quoted in the tasks they constrain):
  - server/INSIGHTS.md: 2026-09-22 drop+add in one `db:generate` prompts (this plan has no drop, one pass); 2026-09-22 Drizzle text enum hint is not a DB constraint; 2026-09-20 `pgTable` grep undercounts; 2026-09-22 helpers↔repository row-type cycle; 2026-09-22 a container facade for a service that takes `Container` makes a cycle; 2026-09-30 no cross-module import, type-only included; 2026-09-22 `setSkills` is the transaction shape to copy; 2026-09-21 multi-table writes go in one transaction; 2026-09-19 cost `null` = unknown, `0` = free; 2026-09-29 a `running` row inserted before `buildApp()` is reaped; 2026-09-26 an unmocked LLM client in an it-test makes real calls; 2026-09-19 `waitForPrRuns` returns on timeout (assert terminal status); 2026-09-19 test fire-and-forget by inserting rows; 2026-10-04 `maxRetries` is not "one HTTP request"; 2026-09-22 testcontainers flakiness.
  - client/INSIGHTS.md: 2026-09-21 `Modal` is not portaled; 2026-09-26 `fireEvent` only; 2026-09-21 `@messages/…` alias; 2026-09-21 `vi.mock` with alias paths (and grep `vi.mock("\.` before a move); 2026-09-19 no re-export shim after promoting a helper; 2026-10-03 dot reporter; 2026-10-03 skill-detail / agent-editor scroll chain keeps `minHeight: 0`; 2026-09-19 `formatUsd` (em dash); 2026-09-19 border shorthand vs longhand; 2026-09-22 `IconName` renames; 2026-09-22 `Skeleton` has no `lines`; 2026-10-04 `SectionLabel` header actions in its `right` prop.
  - e2e/INSIGHTS.md: 2026-09-30 a green `./scripts/e2e.sh` (next dev) does not mean CI (production build) passes — wait for data-driven text before `find … click`; 2026-09-26 a `find` step with no action verb clicks; 2026-09-26 `wait --text` matches the rendered text after CSS `text-transform`.
  - INSIGHTS.md (root): 2026-09-19 diff only the contract files you touched; 2026-09-21 `zod/v4` imports compile; 2026-09-26 / 2026-10-03 `typecheck` never covers `server/test/` (scratch tsconfig, `rootDir: ".."`); 2026-09-29 `rg` is not installed (gates use `grep -rnE`).
- Spec invariants that apply: `server/specs/skills.md` S2 (prompt = skills on at both levels, in `agent_skills.order` — a skill eval run overrides this for that run only, SPEC-06 AC19), S4 (version + `skill_versions` row on a body change), S7 (workspace scope); `server/specs/review-flow.md` invariant 1 (grounding is mandatory — T022 changes the parser it grounds against), 2 (unknown cost is `null`), 5 (boot reaping, one API instance per database), 6 (one content-free `prompt.assembled` per prompt); `reviewer-core/CLAUDE.md` (`INJECTION_GUARD` is the only injection defence, optional slots omitted when empty); `client/specs/pages.md` URL-state rule ("An unrecognised value reads as 'no filter'") for the skill `?tab=evals`; `e2e/docs/coverage-spec.md` › Rules a new flow must keep (read-only, deterministic locators, self-contained entry, assert what a user reads, accessible names) for T025; the SPEC-04 plan A2 (errored row shows the reason), A6 (eval task line from the frozen PR title only), A7 (per-case `withTimeout`), A15 (revision shape), A17 (name clash retry); the SPEC-05 plan A2 (every eval run-start route uses `runStartGuard`, a refused start costs nothing).
- Closest existing features followed: `server/src/modules/reviews/` (a module with both `repository.ts` and a `repository/` folder, plus `run-executor.ts`) for the evals module growth; `server/src/modules/agents/repository.ts` `setSkills` for transactions; the SPEC-04 `EvalService` / `EvalRepository` for run execution and `getRun`; `client/src/components/project-context/` (a shared folder used by both the agent editor and the skill detail) for promoting the eval list pieces and the editor; the skill detail `ContextTab` for a new skill tab; `client/src/lib/hooks/skills.ts` for hook and invalidation shape; `server/test/grounding.test.ts` (the parser's only test today) for T022; `e2e/specs/03-agents.flow.json` and `e2e/specs/08-smart-diff.flow.json` (entry through `/agents`, button clicks by accessible name) for T025.

## Requirements review
- **Already there (from the SPEC-04 / SPEC-05 plans, not re-planned):** case content in append-only revisions and every run recording `(case_id, revision_id, revision)` (SPEC-06 AC11 storage, AC12 recording); `caseSetDiff` keyed by `revision_id`, so a case at two revisions already counts as 1 added + 1 removed in compare and the alert (SPEC-05 plan T002, which tests SPEC-06 EC15) — this plan only proves it end to end (T019); `latest_result.case_revision_id` on every list item, enough to derive "edited since last run" (SPEC-06 AC13) on the client; the unique index `eval_cases_owner_name_uq` on `(workspace_id, owner_kind, owner_id, name)`, which already covers skill-owned cases (`owner_kind = 'skill'`, `owner_id = skill_id`) and needs no change in migration 0019; `runStartGuard`; pure scoring with no model; the `eval.caseEditor` and `eval.evalsTab` message keys; `formatUsd`; `useConfirm`; `useAgents` / `useAgent`; `toPercent`, `formatPercent`, `deltaPoints`, `signedNumber` in `client/src/lib/eval-metrics.ts` (R5 only re-points consumers to them); `GET /eval-runs/:id` with `AgentEvalRunDetail` and its workspace-scoped `getRun` (R4 widens it).
- **Missing in code (planned):**
  - No manual case: `eval_cases` has no skill FK and revisions no expected output; the contract's `provenance` and `agent_id` are non-null → `skill_id` FK, `expected_output` column, nullable `provenance` / `agent_id` in `AgentEvalCase` (T001, T004).
  - No validation parity: the server parses diffs leniently (`adapters/git/diff-parser.ts` skips stray lines) and the client cannot import server code → one pure strict parser and draft validator in a NEW contract file present byte-identically in both `vendor/shared` copies, run by the editor while typing and by the service on every save (T002).
  - The engine parser counts a `\ No newline at end of file` line as a context line (it falls through to the "context" branch of `parseUnifiedDiff`), so every new-side number after the marker is one too high and a phantom covered line appears after the hunk; the strict editor parser does not count it (A2). A case written against the editor's numbers would be graded against shifted numbers (accepted R3) → T022.
  - No scratch single-case result → new `eval_case_checks` table, newest result per revision by upsert, one running per case by a partial unique index (T004, T006, T012).
  - Skill runs cannot live under `eval_suite_runs.agent_id` (its FK cascades on agent delete, against SPEC-06 AC23, and its one-running index would block the agent's own run, against the NFR) → `agent_id` becomes nullable; skill runs carry `skill_id` (cascade), `skill_version`, `via_agent_id` (SET NULL) and `agent_name`; a second partial unique index gives one running run per skill (T004, T007). Every SPEC-04 / SPEC-05 reader of agent runs is narrowed to `agent_id IS NOT NULL` so skill runs never reach agent views or dashboards (T004); the owner-neutral run detail `GET /eval-runs/:id` is widened again for both owners, tagged by `owner_kind` (accepted R4, T023).
  - No remembered agent per skill → new `skill_eval_agents` table keeping the agent name after the agent is deleted, for "<agent name> no longer exists" (T004, T007, T013).
  - SPEC-04's per-case execution is private to `EvalService` → extracted to `evals/run-executor.ts` and reused by full runs, skill runs and single-case runs (T008, T012, T013).
  - The SPEC-04 Evals tab pieces (case list, metric cards, run history) live inside the agent editor feature, and a feature may not import another → promoted to `client/src/components/eval-suite/` on this second consumer, with row actions, "edited since last run" and the single-case line added (T011); the metric helpers that move with them already exist in `client/src/lib/eval-metrics.ts` and are dropped from the moved file (accepted R5, T024).
  - The skill detail has no Evals tab and no header action (`SkillDetail/constants.ts` says "Deliberately NO Evals tab") → T015, T018.
  - A save whose name another case of the set took between the service's check and the write (two tabs, two saves) hits `eval_cases_owner_name_uq` → the repository reports `name_taken` and the service answers the AC8 refusal, not a 500 (accepted R2; T001, T006, T012).
  - No browser flow covers the case editor journey (accepted R1) → T025, with the accessible names it selects by pinned in T010 and T014.
- **Unclear, settled as Assumptions below:** how name uniqueness is checked and guaranteed (A1); which lines count as diff headers, blank lines, line numbering (A2); the strip's source when the run covered an older revision (A3); expected output of finding-made cases (A4); what the row shows after a row run (A5); Save keeps the dialog open (A6); Run case on a skill with no remembered agent (A7); how long "Too many runs" disables (A8); the shape `GET /eval-runs/:id` answers for each owner (A9); deleting a skill case (A10); checks interrupted by a restart (A11); notes (A12); concurrent edits (A13); the expected finding's severity / category / title are not scored (A14); how the engine parser treats the marker (A15); the e2e flow's single write (A16); the sign character of a negative delta after R5 (A17); the e2e flow's case content (A18).
- **Contradictory:** `server/CLAUDE.md` lists `src/vendor/shared/**` as do-not-touch while root `CLAUDE.md` requires contract changes in both copies; the SPEC-04 and SPEC-05 plans already edit it, so this plan follows the root rule. Putting pure functions (not only schemas) into `vendor/shared` is new; it is the only way the editor and the server run the same validation code (spec NFR Validation parity) without a cross-package import, and `contracts-are-the-core` still holds because the file imports only zod and its siblings (T002). Onion §6 prefers a service-owned `UnitOfWork`; the codebase's transactions are repository-owned (`AgentsRepository.setSkills`), so the case + revision writes follow that shape, as both earlier plans do. Accepted R1 contradicts `e2e/docs/coverage-spec.md` › Rules a new flow must keep, rule 1 ("Read-only. No flow may mutate seeded data or trigger a model call.") and its "Deliberately not covered" row "writes of any kind (add repo, edit agent, delete run)": Save writes one case. The flow mutates no seeded row (it adds one), sorts last (`10-…`), no flow reads eval cases, and the hermetic Postgres is empty every run; T025 records the exception in that file (A16). The user accepted R1 with Save in it, so it is planned; see the report for the alternative.
- **Contract reach:** both `eval-ci.ts` copies (eval section identical, checked 2026-10-13: the two files differ only on the `knowledge.js` import line, `AgentManifest` and one `provider` enum outside the eval section) and both `index.ts` barrels change identically, plus the new `eval-case.ts` in both copies (T001, T002). `knowledge.ts` is unchanged (`EvalOwnerKind` is reused from it). T022 changes no contract (`UnifiedDiff` / `DiffHunk` keep their shape). R4's `SkillEvalRunDetail` / `EvalRunDetail` go into the same eval section in T001; `AgentEvalRunDetail` itself is unchanged; no client code reads `GET /eval-runs/:id` today and `mcp/` declares no eval schema (checked 2026-10-13), so no hook and no `mcp/src/api/schemas.ts` edit is needed.
- **Spec coverage (every AC → tasks):** AC1 T005·T010·T014·T017·T018·T025 · AC2 T002·T010 · AC3 T002·T010·T012·T016 · AC4 T002·T010·T016 · AC5 T002·T010·T012·T022 · AC6 T001·T002·T010 · AC7 T002·T010 · AC8 T001·T002·T006·T012·T014·T016 · AC9 T006·T011·T012·T016·T025 · AC10 T012·T014·T016 · AC11 T003·T006·T012·T016 · AC12 T016·T019 · AC13 T011·T017 · AC14 T008·T012·T014·T016·T022 · AC15 T003·T004·T006·T014·T016 · AC16 T004·T006·T014·T016 · AC17 T005·T018 · AC18 T004·T007·T013·T015 · AC19 T003·T008·T013·T019 · AC20 T004·T007·T013·T019·T023 · AC21 T013·T015·T019 · AC22 T007·T011·T018·T019·T023 · AC23 T004·T019 · AC24 T006·T007·T012·T013·T016·T019·T023 · AC25 T008·T016. Package specs (user decision) → T021. Accepted R2 → T001·T006·T012·T016; accepted R3 → T022; accepted R1 → T010·T014·T025; accepted R4 → T001·T007·T023; accepted R5 → T024.

## Assumptions
- A1 — Name uniqueness (AC8) has two layers. The service checks the draft name against the other cases of the owner's set (`caseNames`, the case's own name excluded) on create and on every save, so the editor and the server name the reason (`name_taken`) before any write. The guarantee is the SPEC-04 plan's full unique index `eval_cases_owner_name_uq (workspace_id, owner_kind, owner_id, name)`: a name taken between that check and the write (a concurrent save) makes the insert or rename fail on the index, the repository reports `name_taken`, nothing is written (the case + revision transaction rolls back), and the service answers the same AC8 refusal, 422 `eval_case_invalid` with `{ field: 'name', code: 'name_taken' }`. Because SPEC-04 suffixes finding-made names, no set can hold a duplicate name when this plan ships, so a save that keeps a case's own name never collides.
- A2 — Strict diff parsing (AC2, AC3, EC1): lines split on `\n` with a trailing `\r` removed; trailing empty lines at the end are ignored. Outside a hunk only file-header lines are allowed: `diff --git `, `index `, `--- `, `+++ `, `new file mode`, `deleted file mode`, `old mode`, `new mode`, `similarity index`, `dissimilarity index`, `rename from`, `rename to`, `copy from`, `copy to`, `Binary files `. A hunk starts with `@@ -a[,b] +c[,d] @@` after a `+++ ` line; its body lines start with ` `, `+`, `-` or `\` (`\ No newline…`, not counted); an empty line inside an unfinished hunk counts as a context line. When a hunk's old/new counts are reached the next line must be a header; a body line beyond the counts, or a non-body line before they are reached, is `diff_hunk_count_mismatch` reported at the hunk header's line (EC3). A non-header line outside a hunk, or a hunk header before any `+++ ` line, is `diff_stray_line` at that line (EC4). Empty diff → line 1; over 100,000 characters → the line holding character 100,001; no hunk → line 1. The path comes from `+++ b/<p>` (`b/` and a tab suffix stripped), or from `--- a/<p>` when `+++ /dev/null`. Line numbers are 1-based lines of the pasted text.
- A3 — The last-run strip (AC15) uses the latest completed run's result only when that result covered the case's CURRENT revision; otherwise only the single-case result of the current revision is a candidate. The newer of the two by finish time is shown; nothing → "Not run yet".
- A4 — A case made from a finding (SPEC-04) has no stored expected output; the API shows it as `[]` for `must_not_flag` or one finding built from its provenance (severity, category, title) and expectation for `must_find`. Its fields are read-only (AC10), so the editor's JSON rules are not applied to it.
- A5 — A row's run action shows, under that row, "Running…" then the AC14 line of the newest single-case result of the case's current revision. The row's main result stays the latest completed run's result (or "edited since last run", AC13); a single-case result never replaces it.
- A6 — Save keeps the dialog open (title becomes "Eval case · <name>") so the strip can show a Run-on-save result; Cancel / Close / Escape closes it and returns focus to the element that opened it.
- A7 — Run case and a row run on a skill case need the skill's remembered agent; with none (or a deleted one) they are disabled with "Choose an agent for this skill first", and the tab's Run all evals / Change agent asks for one (AC18). The server refuses the same with 422 `eval_agent_required` / `eval_agent_missing`.
- A8 — After a 429 `run_start_rate_limited`, the component disables Run case / row runs / Run all evals with "Too many runs — try again in a minute" until `details.retry_after_ms` has passed (60 s when absent). The global toast also shows (user decision).
- A9 — (rewritten 2026-10-13, accepted R4) `GET /eval-runs/:id` answers `EvalRunDetail`, a discriminated union on `owner_kind`: an agent run is today's `AgentEvalRunDetail` plus `owner_kind: 'agent'`; a skill run is `SkillEvalRunSummary` + `config`, `cases`, `results` plus `owner_kind: 'skill'` (`skill_id`, `skill_version`, `agent_id` = the via agent or `null` once deleted, `agent_name`, `agent_deleted`). The lookup stays scoped to the caller's workspace only (no owner in the path, as today); a run of another workspace → 404. No client hook or UI reads it in this plan; a skill run's drill-down screen stays out of scope. Between T004 (Wave 0, which narrows `getRun` like every agent read) and T023 (Wave 4) a skill run id answers 404; only the final state is a contract.
- A10 — A skill case is deleted through the existing `DELETE /eval-cases/:id` (workspace-scoped, SPEC-04); the skill tab invalidates its own lists.
- A11 — A single-case run still `running` at boot is closed as `errored` with the reason "interrupted by a server restart" (same boot hook as SPEC-04's reaper, `server/specs/review-flow.md` invariant 5).
- A12 — Notes are not shown or edited by the editor (AC1 lists no notes field); a revision never changes them and they are never sent to the model (AC25).
- A13 — Two saves of the same case at the same moment: the second revision insert hits `UNIQUE (case_id, revision)` and answers 409 `eval_case_edit_conflict` ("The case changed while you were editing — reopen it"); nothing is half-written.
- A14 — Scoring uses only the expectation (type, file, lines), as SPEC-04 defines it. The expected finding's severity, category and title are stored and shown, never scored (spec Non-goals: SPEC-04 semantics are not re-decided).
- A15 — The engine parser (T022) skips a `\` line inside a hunk entirely: no new-side number, no cursor move, not an addition or deletion. A `\` line outside a hunk is ignored as before. Nothing else in `parseUnifiedDiff` changes (its other leniencies — stray lines skipped, an empty string counted as context — stay as they are), so the only behaviour change on the review path is that grounding no longer accepts the phantom line after a marker and no longer shifts the lines after it. Stored reviews are not re-grounded.
- A16 — (accepted R1) The e2e flow `10-case-editor` writes exactly one manual case, `e2e-manual-case`, on the seeded "Security Reviewer" agent and nothing else: it never clicks Run case or Run all evals, and Run on save stays at its default (off), so no model call and no run row. It runs last in filename order and no flow reads eval cases, so it changes nothing another flow asserts on. It is meant for the hermetic stack (`./scripts/e2e.sh`, empty Postgres every run) and CI; a second run against a long-lived dev DB fails on `name_taken`, which T025 states in `e2e/docs/coverage-spec.md` next to the exception to rule 1.
- A17 — (accepted R5) `formatDelta` (ASCII "-2") is not kept: the moved `MetricCards` uses `signedNumber` from `client/src/lib/eval-metrics.ts`, as the SPEC-05 dashboard does, so a negative delta on the agent and skill Evals tabs reads "−2" (U+2212) like the dashboards; "+4" and "0" read as before. The skills `SkillsView/helpers.ts` `formatPercent` (pull / accept rates) is a different helper and stays.
- A18 — The flow's case content is fixed: name `e2e-manual-case`; diff `--- a/src/e2e.ts` / `+++ b/src/e2e.ts` / `@@ -1,2 +1,3 @@` / ` const a = 1;` / `+const b = 2;` / ` export { a };`; `must_not_flag`, file `src/e2e.ts`, lines 2–2, expected output the default `[]` — valid under A2 and every T002 rule, and no JSON has to be typed.

## Recommendations
- none open. R2 (unique names, the SPEC-04 suffix rule and index) and R3 (the engine parser skips `\ No newline at end of file`) were accepted by the user on 2026-10-12 and are planned: R2 in the SPEC-04 plan (T002, T004, T006, T009) plus A1 / T001 / T006 / T012 / T016 here, R3 as T022. R1 (one e2e flow over the editor journey), R4 (`GET /eval-runs/:id` serves skill runs) and R5 (one home for the eval metric helpers) were accepted by the user on 2026-10-13 and are planned: R1 as T025 (with accessible names pinned in T010 and T014, A16, A18), R4 in T001 / T007 and as T023 (A9), R5 as T024 (A17). None of them is a recommendation any more.

## Scope
- In: every AC (AC1–AC25) of SPEC-06-case-editor: contracts in both `eval-ci.ts` copies; a new shared `eval-case.ts` (strict diff parser, draft validator, finding skeleton) in both copies; pure domain rules; schema + one generated migration (0019); the case and skill-eval repositories; the shared per-case run executor; `EvalCaseService` (get, create, edit with revisions, list per owner, single-case run, boot reaping of checks); `EvalService` skill runs and the remembered agent; owner-scoped routes, every run start behind `runStartGuard`; the narrowing of SPEC-04 / SPEC-05 agent-run readers; client hooks; the shared Case Editor dialog; the promoted `eval-suite` list pieces with row actions; the agent Evals tab wiring; the skill Evals tab, header "Run on evals", agent picker; docs; package specs `server/specs/case-editor.md` (new) and edits to `server/specs/README.md`, `server/specs/skills.md`, `server/CLAUDE.md`, `client/specs/pages.md`, `client/specs/README.md` (T021, user decision). From accepted R2: the name-clash path on save (index violation → AC8 refusal). From accepted R3: the engine diff parser skips `\ No newline at end of file` lines, with its own test (T022). From accepted R1: one browser flow `e2e/specs/10-case-editor.flow.json`, its coverage rows in `e2e/README.md` and `e2e/docs/coverage-spec.md` (with the write exception), and the accessible names it selects by (T010, T014, T025). From accepted R4: `SkillEvalRunDetail` / `EvalRunDetail` in both contract copies, `GET /eval-runs/:id` answering either owner from the widened SPEC-04 `getRun` mapper, with its integration test (T001, T007, T023). From accepted R5: `toPercent`, `formatPercent`, `deltaPoints`, `formatDelta` leave `client/src/components/eval-suite/helpers.ts`; their one home is `client/src/lib/eval-metrics.ts` (T024).
- Out: moving or copying cases between owners, skill-owned cases from findings, import/export, bulk edit, LLM judge, full-file inputs (spec Non-goals); changing SPEC-05's notice wording; skill runs on any dashboard (user decision); a cancel action for single-case or skill runs; editing notes; any other leniency of the engine parser (A15); re-grounding stored reviews; a client screen, hook or MCP tool for a run's detail (R4 is the API only); any other e2e flow (editing, run case, the skill tab); changing `client/src/components/eval-ui/` or the skills `formatPercent`; any edit to the root `specs/` files.

## Design

Rings (onion-architecture §2, §4) — all new server code stays in the existing `evals` module, because single-case runs and skill runs reuse its run execution, and modules may not import each other:
- **Contracts (core):** `eval-ci.ts` (response shapes, error codes, the owner-tagged run detail union of R4) and the new `eval-case.ts` (draft schema + pure validation code) in both `vendor/shared` copies (T001, T002). Why the validator lives here: it is the one place both the client and the server already import from, so "a valid form never fails on save" holds by construction (spec NFR Validation parity), and the file needs nothing but zod.
- **Domain (pure, `domain-is-pure`):** `server/src/domain/evals/case-editor.ts` (content-changed test, expected output of finding-made cases, last-run pick, skill injection into a run config) and `run-owner.ts` (agent-run row guard) (T003).
- **Module internal types:** `server/src/modules/evals/editor-types.ts` — plain interfaces shared by the new repositories, executor and services, so no helpers↔repository cycle forms (T001).
- **Infrastructure:** `server/src/modules/evals/repository/case.repo.ts` (`EvalCaseRepository`: cases per owner, revisions, checks, the name-clash mapping on `eval_cases_owner_name_uq`) and `repository/skill-eval.repo.ts` (`SkillEvalRepository`: remembered agent, skill row, skill cases for a run, skill runs, and the pure row mapper `toSkillRunSummary` next to it). Both match `arch:check`'s `REPOSITORY` pattern (`repository/`), like `reviews/repository/` (T006, T007). The SPEC-04 `EvalRepository.getRun` (in `repository.ts`) maps a run row by owner — skill runs through `toSkillRunSummary`, agent runs through its private `toSummary` — into the `EvalRunDetail` union (accepted R4, T023); the mapper is shared, not copied, and the import points `repository.ts` → `repository/skill-eval.repo.ts` only, so no cycle forms.
- **Engine diff parser (accepted R3):** `server/src/adapters/git/diff-parser.ts` — a pure parser that lives under `adapters/` (onion-architecture §3, known debt). It is used by the review path (`reviews/diff-loader.ts`, `adapters/git/simple-git.ts`, the mock git client) and injected into every eval run as `parseDiff`. T022 changes only how it treats `\` lines, so the engine's new-side numbers equal the editor parser's (A2, A15).
- **Application:** `server/src/modules/evals/run-executor.ts` — `runCaseReview` (one case through the engine, scored, never throws) and `resolveRunConfig` (agent config, or agent config + skill injected) — the file name matches `arch:check`'s APPLICATION pattern (T008). `EvalService` (SPEC-04 `service.ts`) uses it for full and skill runs (T013); its `getRun` returns the union with no owner branching (T023). `EvalCaseService` in `case-service.ts` owns the editor use cases (T012); its name does not match the APPLICATION pattern, so its Verify greps that it imports no Drizzle, `db/*` or adapter.
- **Presentation + wiring:** `evals/routes.ts` gains owner-scoped routes, every run start with `preHandler: runStartGuard(container)`; `container.evals` gets the skill repository, a new `container.evalCases` getter builds `EvalCaseService` from narrow deps; `app.ts` reaps stale checks on boot (T013, T016); `GET /eval-runs/:id` declares `EvalRunDetail` as its 200 response (T023).
- **Client:** hooks `client/src/lib/hooks/eval-cases.ts` (T009); the Case Editor in shared `client/src/components/case-editor/` (inputs T010, dialog T014) — shared because both the agent editor and the skill detail open it; the promoted `client/src/components/eval-suite/` (T011), whose metric formatting comes from the existing tier-1 `client/src/lib/eval-metrics.ts`, the one home of the whole-percent rule shared with the SPEC-05 dashboards (frontend-ui-architecture §3 `lib` vs `helpers`; T024); the agent Evals tab wiring (T017); the skill Evals tab, run action and agent picker in `SkillDetail/_components/EvalsTab/` (T015, T018).
- **e2e (accepted R1):** one deterministic agent-browser flow `e2e/specs/10-case-editor.flow.json` over the seeded "Security Reviewer" agent; it selects the editor's controls by accessible names that T010 and T014 pin and their tests assert, so a rename breaks a unit test before it breaks the flow (T025).

```mermaid
sequenceDiagram
  participant UI as CaseEditor / Evals tabs
  participant R as evals/routes.ts
  participant G as runStartGuard (10/min/ws)
  participant CS as EvalCaseService
  participant S as EvalService
  participant V as vendor/shared eval-case.ts
  participant X as run-executor
  participant DB as Postgres
  UI->>V: validateCaseDraft while typing (300 ms debounce)
  UI->>R: POST|PUT /{agents|skills}/:id/eval-cases[/:caseId]
  R->>CS: createCase / updateCase
  CS->>V: validateCaseDraft (same code, names of the set) → 422 eval_case_invalid
  CS->>DB: case + revision 1, or rename (+ revision N+1) in one transaction
  DB-->>CS: unique violation on eval_cases_owner_name_uq → name_taken → 422 eval_case_invalid (AC8)
  UI->>R: POST …/eval-cases/:caseId/check
  R->>G: count start (429 when over)
  R->>CS: startCheck
  CS->>X: resolveRunConfig(owner) (skill → remembered agent + skill injected)
  CS->>DB: upsert eval_case_checks running (one per case) → 409 | id
  CS-->>UI: 202 { check_id }
  CS->>X: runCaseReview (parseDiff = engine parser, `\` lines skipped; scoring, no LLM in scoring)
  CS->>DB: finish check (newest per revision)
  UI->>R: GET …/eval-cases/:caseId every 2 s while running → last_run
  UI->>R: POST /skills/:id/eval-runs
  R->>G: count start
  R->>S: startSkillRun → resolveRunConfig → createSkillRun (one per skill) → execute via runCaseReview
  Note over R,DB: any API client: GET /eval-runs/:id → getRun (workspace-scoped) → EvalRunDetail tagged owner_kind agent | skill (R4)
```

### Contracts
Both `server/src/vendor/shared/contracts/eval-ci.ts` and `client/src/vendor/shared/contracts/eval-ci.ts`, eval section, all Zod 3 (T001). `EvalOwnerKind` comes from `knowledge.ts`; `Severity`, `FindingCategory` from `findings.ts`; `AgentEvalCase`, `EvalCaseLatestResult`, `EvalCaseResultStatus`, `EvalExpectationType`, `EvalExpectation`, `AgentEvalRunSummary`, `AgentEvalRunDetail`, `EvalRunConfig`, `EvalRunCaseRef`, `EvalRunRecord`, `StartEvalRunResponse`, `EvalErrorCode` are the SPEC-04 schemas.
- Changed: `AgentEvalCase.agent_id` → `z.string().nullable()` (null for skill cases); `AgentEvalCase.provenance` → `EvalCaseProvenance.nullable()` (null for manual cases). Names keep their SPEC-04 `Agent` prefix to avoid a rename across shipped code; they now describe a case of either owner.
- `EvalErrorCode` gains `'eval_case_invalid'` (422, `details: { issues: EvalCaseIssue[] }`), `'eval_case_content_fixed'` (422), `'eval_case_edit_conflict'` (409), `'eval_case_check_in_progress'` (409), `'eval_agent_required'` (422), `'eval_agent_missing'` (422, `details: { agent_name }`). A name clash caught by the index reuses `eval_case_invalid` with a `name_taken` issue (A1); no new code.
- `EvalCaseOrigin = z.enum(['finding','manual'])` · `EvalCaseOwner = z.object({ kind: EvalOwnerKind, id: z.string() })`
- `EvalExpectedFinding = z.object({ severity: Severity, category: FindingCategory, title: z.string().min(1).max(200), file: z.string().min(1), start_line: z.number().int().positive(), end_line: z.number().int().positive().optional() }).strict()` · `EvalExpectedOutput = z.array(EvalExpectedFinding).max(1)` (stored shape)
- `EvalExpectedFindingView = z.object({ severity: Severity, category: FindingCategory, title: z.string(), file: z.string(), start_line: z.number().int(), end_line: z.number().int().optional() })` (display shape; a finding-made case's title may exceed 200, A4)
- `EvalCaseCheckStatus = z.enum(['running','passed','failed','errored'])`
- `EvalCaseCheck = { id; case_revision_id; status: EvalCaseCheckStatus; started_at; finished_at: string | null; duration_ms: int | null; expected: int ≥ 0; got: int | null; error: string | null; cost_usd: number | null }`
- `EvalCaseLastRunSource = z.enum(['check','run'])` · `EvalCaseLastRun = { source; status: EvalCaseResultStatus; expected: int ≥ 0; got: int | null; error: string | null; duration_ms: int | null; cost_usd: number | null; finished_at: string }`
- `EvalCaseListItem = AgentEvalCase.extend({ latest_result: EvalCaseLatestResult.nullable(), check: EvalCaseCheck.nullable() })` (`check` = the newest single-case result of the current revision)
- `EvalCaseDetail = AgentEvalCase.extend({ owner: EvalCaseOwner, origin: EvalCaseOrigin, input_diff: z.string(), input_files: z.array(z.string()), expected_output: z.array(EvalExpectedFindingView).max(1), latest_result: EvalCaseLatestResult.nullable(), check: EvalCaseCheck.nullable(), last_run: EvalCaseLastRun.nullable() })`
- `SaveEvalCaseResponse = { case: EvalCaseDetail; revision_created: boolean }` · `StartEvalCaseCheckResponse = { check_id: string }`
- `SkillEvalAgent = { agent: { id; name } | null; missing_agent_name: string | null }` · `SetSkillEvalAgentBody = { agent_id: z.string().uuid() }`
- `SkillEvalRunSummary = AgentEvalRunSummary.omit({ agent_id: true }).extend({ skill_id: z.string(), skill_version: z.number().int().positive(), agent_id: z.string().nullable(), agent_name: z.string(), agent_deleted: z.boolean() })`
- (accepted R4) `SkillEvalRunDetail = SkillEvalRunSummary.extend({ config: EvalRunConfig, cases: z.array(EvalRunCaseRef), results: z.array(EvalRunRecord) })`
- (accepted R4) `EvalRunDetail = z.discriminatedUnion('owner_kind', [AgentEvalRunDetail.extend({ owner_kind: z.literal('agent') }), SkillEvalRunDetail.extend({ owner_kind: z.literal('skill') })])` — the 200 body of `GET /eval-runs/:id` (A9). `AgentEvalRunDetail` itself is unchanged, so every existing parse of it still holds.

New `server/src/vendor/shared/contracts/eval-case.ts` and `client/src/vendor/shared/contracts/eval-case.ts`, byte-identical, exported from both `index.ts` barrels (T002):
- `EVAL_CASE_LIMITS = { diffChars: 100_000, prTitleChars: 300, prDescriptionChars: 4_000, expectedOutputChars: 20_000, findingTitleChars: 200, nameChars: 60 } as const` · `EVAL_CASE_NAME_PATTERN = /^[a-z0-9-]+$/`
- `EvalCaseIssueField = z.enum(['name','input_diff','pr_title','pr_description','expectation','expected_output'])`
- `EvalCaseIssueCode = z.enum(['required','too_long','name_charset','name_taken','diff_no_hunk','diff_hunk_count_mismatch','diff_stray_line','file_not_in_diff','start_below_one','start_after_end','lines_outside_hunks','json_syntax','json_not_array','json_must_be_empty','json_one_finding','json_unknown_key','json_missing_key','json_bad_severity','json_bad_category','json_bad_title','json_mismatch'])`
- `EvalCaseIssue = z.object({ field: EvalCaseIssueField, code: EvalCaseIssueCode, line: z.number().int().positive().nullable(), key: z.string().nullable() })` (`line` for diff issues; `key` = the JSON key for unknown / missing / mismatch)
- `EvalCaseDraft = z.object({ name: z.string(), input_diff: z.string(), pr_title: z.string(), pr_description: z.string(), expectation_type: EvalExpectationType, expectation: z.object({ file: z.string(), start_line: z.number().int(), end_line: z.number().int() }), expected_output_json: z.string() })` (request body of create and update; ranges are checked by `validateCaseDraft`, not by zod, so the reason is named)
- `interface CaseDiffLine { kind: 'file_header' | 'hunk_header' | 'context' | 'add' | 'del' | 'meta'; text: string; sourceLine: number; newLine: number | null }`
- `interface CaseDiffFile { path: string; additions: number; deletions: number; newRanges: { start: number; end: number }[] }`
- `interface CaseDiffParse { files: CaseDiffFile[]; lines: CaseDiffLine[]; issue: EvalCaseIssue | null }`
- `parseCaseDiff(text: string): CaseDiffParse`
- `interface CaseDraftCheck { issues: EvalCaseIssue[]; diff: CaseDiffParse; expectedOutput: EvalExpectedOutput | null }`
- `validateCaseDraft(draft: EvalCaseDraft, otherNames: readonly string[]): CaseDraftCheck` (at most one issue per field, fields in `EvalCaseIssueField` order; `expectedOutput` non-null only when that field has no issue)
- `findingSkeleton(expectation: EvalCaseDraft['expectation']): string` (pretty JSON of `[{ severity: 'WARNING', category: 'bug', title: '', file, start_line, end_line }]`, AC7)

API (module `evals`; `:id` is the owner id, all uuid; every route scoped to the caller's workspace and the owner, else 404):
| Method | Path | Answer |
|---|---|---|
| GET | `/agents/:id/eval-cases` (SPEC-04 path, now through `EvalCaseService`) · `/skills/:id/eval-cases` | `EvalCaseListItem[]` |
| POST | `/agents/:id/eval-cases` · `/skills/:id/eval-cases` (body `EvalCaseDraft`) | 201 `SaveEvalCaseResponse` · 422 `eval_case_invalid` (a name clash included, A1) |
| GET | `/agents/:id/eval-cases/:caseId` · `/skills/:id/eval-cases/:caseId` | `EvalCaseDetail` |
| PUT | same (body `EvalCaseDraft`) | 200 `SaveEvalCaseResponse` · 422 `eval_case_invalid` / `eval_case_content_fixed` · 409 `eval_case_edit_conflict` |
| POST | `…/eval-cases/:caseId/check` (no body, `runStartGuard`) | 202 `StartEvalCaseCheckResponse` · 409 `eval_case_check_in_progress` · 422 `eval_agent_required` / `eval_agent_missing` · 429 |
| GET / PUT | `/skills/:id/eval-agent` (PUT body `SetSkillEvalAgentBody`) | `SkillEvalAgent` |
| POST | `/skills/:id/eval-runs` (no body, `runStartGuard`) | 202 `StartEvalRunResponse` · 422 `no_eval_cases` / `eval_agent_required` / `eval_agent_missing` · 409 `eval_run_in_progress` · 429 |
| GET | `/skills/:id/eval-runs` | `SkillEvalRunSummary[]` (newest first) |
| GET | `/eval-runs/:id` (SPEC-04 path, widened by accepted R4; `:id` is the run id, workspace-scoped only) | `EvalRunDetail` (`owner_kind` `agent` or `skill`) · 404 |

Skill cases are deleted through SPEC-04's `DELETE /eval-cases/:id` (A10).

### i18n keys (added by T005; every UI task uses exactly these; existing keys and texts stay)
`client/messages/en/skills.json`: `detail.tabs.evals` = "Evals"; `detail.runOnEvals` = "Run on evals".

`client/messages/en/eval.json` — inside the existing `caseEditor` (keep `newCase`, `caseTitle`, `runCase`, `running`, `save`, `saving`, `nameLabel`, `namePlaceholder`, `inputLabel`, `tabs.diff`, `tabs.prMeta`, `diffPlaceholder`, `titleLabel`, `titlePlaceholder`, `bodyLabel`, `bodyPlaceholder`, `preview`, `expectedOutput`, `validJson`, `invalidJson`, …), add:
```json
{
  "tabs": { "files": "Files" },
  "ownerAgent": "Agent · {name}",
  "ownerSkill": "Skill · {name}",
  "cancel": "Cancel",
  "close": "Close",
  "filesEmpty": "No files yet — paste a diff in the Diff tab.",
  "fileStats": "+{added} −{removed}",
  "previewEmpty": "The preview appears here.",
  "expectationLabel": "Expectation",
  "fileLabel": "File",
  "filePlaceholder": "Choose a file of the diff",
  "startLineLabel": "Start line",
  "endLineLabel": "End line",
  "findingSkeleton": "+ Finding skeleton",
  "skeletonDisabledHint": "Nothing is expected for must_not_flag",
  "runOnSave": "Run on save",
  "fromFindingHint": "Created from a finding — input and expectation are fixed",
  "counter": "{count} / {limit}",
  "viaAgent": "via {name}",
  "runBlocked": { "unsaved": "Save first", "running": "Already running", "rateLimited": "Too many runs — try again in a minute", "noAgent": "Choose an agent for this skill first" },
  "lastRun": { "passed": "Last run passed", "failed": "Last run failed", "errored": "Last run errored", "expectedGot": "expected {expected, plural, one {# finding} other {# findings}}, got {got}", "duration": "{seconds}s", "running": "Running…", "never": "Not run yet" },
  "errors": { "eval_case_content_fixed": "Created from a finding — input and expectation are fixed", "eval_case_edit_conflict": "The case changed while you were editing — reopen it", "eval_case_check_in_progress": "Already running", "eval_agent_required": "Choose an agent for this skill first", "eval_agent_missing": "The skill's agent no longer exists — choose another", "run_start_rate_limited": "Too many runs — try again in a minute", "generic": "Could not save or run the case." },
  "issues": {
    "name": { "required": "Name is required", "too_long": "Name is longer than {limit} characters", "name_charset": "Use only lowercase letters, digits and hyphens", "name_taken": "Another case in this set already has this name" },
    "input_diff": { "required": "Line {line}: the diff is empty", "too_long": "Line {line}: the diff is longer than {limit} characters", "diff_no_hunk": "Line {line}: the diff has no hunk", "diff_hunk_count_mismatch": "Line {line}: the hunk's line counts disagree with its header", "diff_stray_line": "Line {line} is outside a hunk and is not a file header" },
    "pr_title": { "too_long": "Title is longer than {limit} characters" },
    "pr_description": { "too_long": "Description is longer than {limit} characters" },
    "expectation": { "file_not_in_diff": "The file is not a file of the diff", "start_below_one": "Start line must be 1 or more", "start_after_end": "Start line must not be after the end line", "lines_outside_hunks": "The lines intersect no hunk of this file" },
    "expected_output": { "too_long": "Expected output is longer than {limit} characters", "json_syntax": "Not valid JSON", "json_not_array": "Expected output must be a JSON array", "json_must_be_empty": "must_not_flag expects []", "json_one_finding": "must_find expects exactly one finding", "json_unknown_key": "Unknown key \"{key}\"", "json_missing_key": "Missing key \"{key}\"", "json_bad_severity": "severity must be CRITICAL, WARNING or SUGGESTION", "json_bad_category": "category must be bug, security, perf, style or test", "json_bad_title": "title must be 1–{limit} characters", "json_mismatch": "\"{key}\" must equal the expectation's value" }
  }
}
```
Inside the existing `evalsTab` add `"editedSinceLastRun": "edited since last run"` (rows use the existing `run`, `running`, `edit`, `delete`, `neverRun`). New top-level `skillEvals`:
```json
{
  "metricsSubtitle": "Recall / Precision / Citation for this skill's eval cases, run through an agent",
  "casesHeading": "Eval cases",
  "emptyCases": "No eval cases yet. Create one to measure this skill.",
  "passing": "{passed} / {total} passing",
  "runAll": "Run all evals",
  "via": "via {name}",
  "changeAgent": "Change agent",
  "blocked": { "noCases": "no eval cases", "inProgress": "eval run already in progress" },
  "picker": { "title": "Choose an agent", "body": "This skill's cases run through the agent you pick, with the skill enabled for that run only. The agent's saved skills do not change.", "label": "Agent", "missing": "{name} no longer exists", "noAgents": "Create an agent first", "confirm": "Use this agent", "cancel": "Cancel" },
  "historyVia": "via {agent} v{agentVersion} · skill v{skillVersion}",
  "agentDeleted": "{name} (deleted)",
  "errors": { "eval_agent_required": "Choose an agent first", "eval_agent_missing": "The agent no longer exists — choose another", "no_eval_cases": "no eval cases", "eval_run_in_progress": "eval run already in progress", "run_start_rate_limited": "Too many runs — try again in a minute", "generic": "Could not start the run." }
}
```
The accessible names the e2e flow (T025) selects by come from existing keys and need no new key: `caseEditor.nameLabel` "Name", `caseEditor.tabs.diff` "Diff", `caseEditor.fileLabel` "File", `caseEditor.startLineLabel` "Start line", `caseEditor.endLineLabel` "End line", `evalsTab.expectation.must_find` "must find", `evalsTab.expectation.must_not_flag` "must not flag", `caseEditor.save` "Save", `caseEditor.newCase` "New eval case", `evalsTab.neverRun` "never run".

### Database
One `pnpm run db:generate` pass → `0019_*.sql` (additions and one `DROP NOT NULL`, no drop of a column, so no rename prompt), all in `server/src/db/schema/eval.ts` (T004):
- `eval_cases` adds `skill_id uuid` FK `skills.id` ON DELETE CASCADE (nullable; set for skill-owned cases, `owner_kind = 'skill'`, `owner_id = skill_id`); index `eval_cases_ws_skill_idx (workspace_id, skill_id)`. Name uniqueness per set is the SPEC-04 plan's `eval_cases_owner_name_uq (workspace_id, owner_kind, owner_id, name)` from migration 0017; it covers skill cases as they are written with `owner_kind = 'skill'`, so 0019 adds no name index.
- `eval_case_revisions` adds `expected_output jsonb` (nullable, `$type<EvalExpectedOutput>`; null for finding-made revisions, A4).
- `eval_suite_runs`: `agent_id` becomes nullable (FK and CASCADE unchanged; null on skill runs); adds `skill_id uuid` FK `skills` ON DELETE CASCADE, `skill_version int`, `via_agent_id uuid` FK `agents` ON DELETE SET NULL, `agent_name text` (the via agent's name at start; skill runs only). Indexes: `eval_suite_runs_skill_started_idx (skill_id, started_at)`, partial `eval_suite_runs_one_running_skill_uq UNIQUE (skill_id) WHERE status = 'running'`, `eval_suite_runs_via_agent_idx (via_agent_id)`. The SPEC-04 `eval_suite_runs_one_running_uq (agent_id)` stays; skill runs have `agent_id` NULL, so they never collide with the agent's own run (spec NFR Concurrency).
- New `eval_case_checks` (single-case results): `id uuid pk`, `workspace_id` FK cascade NOT NULL, `case_id uuid NOT NULL` FK `eval_cases` cascade, `case_revision_id uuid NOT NULL` FK `eval_case_revisions` cascade, `status text NOT NULL` (enum hint `running|passed|failed|errored`), `started_at timestamptz NOT NULL DEFAULT now()`, `finished_at timestamptz`, `duration_ms int`, `expected int NOT NULL`, `got int`, `error text`, `cost_usd double precision` (null = unknown), `findings_returned / findings_grounded / findings_matching int`. Indexes: `eval_case_checks_revision_uq UNIQUE (case_revision_id)` (newest per revision by upsert; also the FK index), `eval_case_checks_case_idx (case_id)`, partial `eval_case_checks_one_running_uq UNIQUE (case_id) WHERE status = 'running'`, `eval_case_checks_ws_idx (workspace_id)`.
- New `skill_eval_agents`: `skill_id uuid PRIMARY KEY` FK `skills` cascade, `workspace_id` FK cascade NOT NULL, `agent_id uuid` FK `agents` ON DELETE SET NULL (nullable), `agent_name text NOT NULL`, `updated_at timestamptz NOT NULL DEFAULT now()`. Indexes: `skill_eval_agents_agent_idx (agent_id)`, `skill_eval_agents_ws_idx (workspace_id)`.
- SPEC-06 AC23 by FK: skill → cases → revisions → checks; skill → skill runs → per-case rows; skill → remembered agent. Agent deleted → its own cases and runs cascade (SPEC-04), skill runs keep their row with `via_agent_id` NULL and `agent_name` kept; the remembered agent row keeps `agent_name` with `agent_id` NULL (SPEC-06 AC21, AC22).
- Safe: the earlier tables are empty or hold only SPEC-04 rows; every addition is nullable or a new table, and `DROP NOT NULL` rewrites nothing. R4 and R5 add no DB change; R1 writes one row at e2e run time only.

## Global constraints
- Zod 3 only (`import { z } from 'zod'`; never `zod/v4`, `zod/mini`) · no do-not-touch path · one migration, only from `pnpm run db:generate` · tests per TESTING.md (one happy path + the edge that matters; no real model call; LLM, GitHub and git mocked in it-tests) · no cross-module import in `server/src/modules/**`, type-only included (`pnpm run arch:check`) · every read and write scoped by `workspace_id` and by the named owner · every run start (single-case, skill, full) goes through `runStartGuard(container)` and carries no route-level `rateLimit` · case revisions are append-only; a name-only save writes no revision · case names are unique per set: the service names the clash first, the SPEC-04 index `eval_cases_owner_name_uq` guarantees it, and an index violation is answered as the AC8 refusal, never a 500 · a single-case result never enters `eval_suite_runs`, `eval_runs`, metric cards, history, trend, alert or dashboards · skill runs never reach agent views or the SPEC-05 dashboards (`agent_id IS NOT NULL` on every agent-run read); the only owner-neutral read is the run detail `GET /eval-runs/:id`, which tags each run with `owner_kind` (R4) · scoring never receives an LLM provider · the model receives only a case's diff, PR title and description through the engine's untrusted slots (`INJECTION_GUARD`); never name, notes or expected output · no diff, expected output, name or notes in any log line or error message · cost `null` = unknown, rendered through `formatUsd` (em dash) · whole-percent metric formatting comes only from `client/src/lib/eval-metrics.ts` (R5) · every label from the `eval` namespace (tab label and header action from `skills`) · pasted text rendered as plain React text, never HTML or markdown · e2e flows make no model call and use deterministic locators only; the one write is the R1 case (A16) · `server/package.json` not edited · package specs change only in T021; the root `specs/` not at all.

## Tasks

### Wave 0 — foundation (sequential)

#### T001 — Case-editor and skill-eval contracts (both copies), widened case shape, owner-tagged run detail, module internal types
- Area: backend
- Agent: implementer
- Depends on: —
- Files (exclusive):
  - `server/src/vendor/shared/contracts/eval-ci.ts` (modified)
  - `client/src/vendor/shared/contracts/eval-ci.ts` (modified)
  - `server/src/modules/evals/editor-types.ts` (new)
  - `server/test/contracts.test.ts` (modified)
  - `client/src/lib/hooks/evals.ts` (new by the SPEC-04 plan T007; modified here)
- Skills: zod → schema-use-enums, schema-use-primitives-correctly, object-strict-vs-strip, object-optional-vs-nullable, object-extend-for-composition, object-pick-omit, object-discriminated-unions, type-use-z-infer, type-export-schemas-and-types; onion-architecture → §2, §4; frontend-ui-architecture → §4; typescript-expert → Code Review Checklist
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - Every closed vocabulary in Design › Contracts (`EvalCaseOrigin`, `EvalCaseCheckStatus`, `EvalCaseLastRunSource`, the six new `EvalErrorCode` values) is a `z.enum([...])` — zod §schema-use-enums
  - `EvalExpectedFinding` ends in `.strict()`, so an unknown key — `__proto__` and `instructions` included — is rejected, not stripped — zod §object-strict-vs-strip
  - Keys always present but possibly empty are `.nullable()`; the only `.optional()` is `EvalExpectedFinding.end_line` / `EvalExpectedFindingView.end_line` (the spec's "optional end_line") — zod §object-optional-vs-nullable
  - `EvalCaseListItem`, `EvalCaseDetail` are `AgentEvalCase.extend({...})`; `SkillEvalRunSummary` is `AgentEvalRunSummary.omit({ agent_id: true }).extend({...})`; `SkillEvalRunDetail` is `SkillEvalRunSummary.extend({ config, cases, results })` — never a copied field list — zod §object-extend-for-composition, §object-pick-omit
  - `EvalRunDetail` is `z.discriminatedUnion('owner_kind', [AgentEvalRunDetail.extend({ owner_kind: z.literal('agent') }), SkillEvalRunDetail.extend({ owner_kind: z.literal('skill') })])`, never a plain `z.union` (an agent branch first would strip a skill run's fields); `AgentEvalRunDetail` itself is not edited (accepted R4) — zod §object-discriminated-unions
  - Counts and versions are `z.number().int()` with `.nonnegative()` / `.positive()` as pinned; titles `.min(1).max(200)` — zod §schema-use-primitives-correctly
  - Every new schema is exported with `export type X = z.infer<typeof X>` — zod §type-export-schemas-and-types, §type-use-z-infer
  - The eval section of the two `eval-ci.ts` copies is byte-identical after the edit; only their import lines differ — onion-architecture §4 (schema the client also uses)
  - `modules/evals/editor-types.ts` holds plain interfaces importing only `@devdigest/shared` and `./types.js` (SPEC-04's `CaseForRun`, `AgentConfigSource`), never a repository; `CaseUpdateOutcome` includes `'name_taken'` (A1) — onion-architecture §2
  - In `client/src/lib/hooks/evals.ts` change only two things: `useCreateEvalCase` invalidates `keys.reviews(...)` only when `data.case.provenance` is non-null, and `useAgentEvalCases` is typed `UseQueryResult<EvalCaseListItem[], Error>`; nothing else — frontend-ui-architecture §4 (tier 2 data access stays in hooks)
  - No `any`; exported interfaces declare every field — typescript-expert §Code Review Checklist (Type Safety)
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - Every schema and type in Design › Contracts (`eval-ci.ts` part), from `@devdigest/shared` — exported here
  - `SkillEvalRunDetail = SkillEvalRunSummary.extend({ config: EvalRunConfig, cases: z.array(EvalRunCaseRef), results: z.array(EvalRunRecord) })` and `EvalRunDetail = z.discriminatedUnion('owner_kind', [AgentEvalRunDetail.extend({ owner_kind: z.literal('agent') }), SkillEvalRunDetail.extend({ owner_kind: z.literal('skill') })])`, with `type EvalRunDetail = z.infer<typeof EvalRunDetail>` — exported here
  - `interface RevisionContent { inputDiff: string; inputFiles: string[]; inputMeta: EvalCaseInputMeta; expectationType: EvalExpectationType; expectation: EvalExpectation; expectedOutput: EvalExpectedOutput | null }` — exported here
  - `interface StoredCase { id: string; owner: EvalCaseOwner; name: string; provenance: EvalCaseProvenance | null; createdAt: Date; revisionId: string; revision: number; content: RevisionContent }` — exported here
  - `interface StoredCaseView { stored: StoredCase; latestResult: EvalCaseLatestResult | null; runResult: EvalCaseLastRun | null; check: EvalCaseCheck | null }` — exported here
  - `interface NewManualCase { workspaceId: string; owner: EvalCaseOwner; name: string; content: RevisionContent }` — exported here
  - `interface CaseUpdate { workspaceId: string; caseId: string; name: string; content: RevisionContent | null }` (null = rename only) — exported here
  - `type CaseUpdateOutcome = 'renamed' | 'revised' | 'conflict' | 'name_taken'` (`'name_taken'` = the new name hit `eval_cases_owner_name_uq`; nothing written) — exported here
  - `interface CheckStart { workspaceId: string; caseId: string; caseRevisionId: string; expected: number }` — exported here
  - `interface CheckFinish { status: 'passed' | 'failed' | 'errored'; finishedAt: Date; durationMs: number; got: number | null; error: string | null; costUsd: number | null; findingsReturned: number | null; findingsGrounded: number | null; findingsMatching: number | null }` — exported here
  - `interface SkillForRun { id: string; name: string; description: string; body: string; version: number }` — exported here
  - `interface SkillEvalAgentRow { agentId: string | null; agentName: string }` — exported here
  - `interface NewSkillRun { workspaceId: string; skillId: string; skillVersion: number; viaAgentId: string; agentName: string; agentVersion: number; config: EvalRunConfig; cases: EvalRunCaseRef[] }` — exported here
  - `interface ResolvedRunConfig { config: EvalRunConfig; agentId: string; agentName: string; skill: { id: string; version: number } | null }` — exported here
  - `interface CaseOutcome { status: 'passed' | 'failed' | 'errored'; error: string | null; findingsReturned: number | null; findingsGrounded: number | null; findingsMatching: number | null; recall: number | null; precision: number | null; citationAccuracy: number | null; durationMs: number; costUsd: number | null; actualOutput: unknown }` — exported here
- Steps:
  1. First confirm the SPEC-04 / SPEC-05 shapes exist as their plans pin them (`AgentEvalCase`, `AgentEvalCaseListItem`, `EvalCaseLatestResult`, `AgentEvalRunSummary`, `AgentEvalRunDetail`, `EvalRunRecord`, `EvalErrorCode` in the server `eval-ci.ts`; `CaseForRun`, `AgentConfigSource` in `server/src/modules/evals/types.ts`; `useCreateEvalCase`, `useAgentEvalCases` in `client/src/lib/hooks/evals.ts`; the `eval_cases_owner_name_uq` index in `server/src/db/schema/eval.ts`); if one is missing or renamed, stop and report.
  2. Test first in `server/test/contracts.test.ts`: an `EvalCaseDetail` of a manual skill case (`agent_id: null`, `provenance: null`, `origin: 'manual'`, one expected finding without `end_line`, a `check` and a `last_run`) parses; `EvalExpectedOutput` rejects `[{…, "__proto__": 1}]` (from `JSON.parse`) and a 201-character title and two findings; a `SkillEvalRunSummary` with `agent_id: null`, `agent_deleted: true` parses; `EvalRunDetail` parses a skill detail with `owner_kind: 'skill'` keeping `skill_id` and `agent_name`, parses the existing SPEC-04 agent detail fixture plus `owner_kind: 'agent'`, and rejects that fixture without `owner_kind`; `EvalErrorCode` accepts `eval_case_invalid`; the existing SPEC-04 / SPEC-05 cases still pass. Run red.
  3. Edit the server eval section, copy it byte-for-byte to the client copy; write `editor-types.ts`; apply the two hook edits.
- Acceptance criteria:
  - SPEC-06 AC6: the stored expected-output shape (severity, category, title 1–200, file, start_line, optional end_line, no other key) exists in both copies.
  - The contracts carry what SPEC-06 AC9–AC16 (detail, revision, check, last run), AC18, AC21 (remembered agent, missing name) and AC20, AC22 (skill run record with skill and agent versions, deleted agent; the owner-tagged run detail of accepted R4) need; `CaseUpdateOutcome` can report a name clash for AC8.
  - `diff server/src/vendor/shared/contracts/eval-ci.ts client/src/vendor/shared/contracts/eval-ci.ts` shows differences only on the import line and outside the eval section.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh server server/src/vendor/shared/contracts/eval-ci.ts server/src/modules/evals/editor-types.ts server/test/contracts.test.ts`
  - `scripts/verify-task.sh client client/src/vendor/shared/contracts/eval-ci.ts client/src/lib/hooks/evals.ts`
  - `diff server/src/vendor/shared/contracts/eval-ci.ts client/src/vendor/shared/contracts/eval-ci.ts`
  - `grep -rnE "zod/(v4|mini)" server/src/vendor/shared/contracts/eval-ci.ts client/src/vendor/shared/contracts/eval-ci.ts` (no output)
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "`diff -r` over the two `vendor/shared` copies is NOT a drift gate." — Rule: after changing a contract, diff ONLY the files you touched … and expect that check to be silent. — `INSIGHTS.md` (2026-09-19)
  - "The installed zod 3.25 exports `zod/v4` …" — Rule: treat any `zod/v4`, `zod/mini` or `@zod/*` import as a violation. — `INSIGHTS.md` (2026-09-21)
  - "Copying `agents/helpers.ts`'s `import type {XRow} from './repository.js'` shape into a NEW module trips `arch:check`'s `no-circular` rule." — Rule: in a new module, declare the row shape `helpers.ts` needs as a local structural interface … — `server/INSIGHTS.md` (2026-09-22)
  - Spec NFR Contract reach: "The case shape today has no expectation type, no expectation location, no origin (manual or from a finding) and no revision; those facts change in both `vendor/shared` copies together, whose eval sections are identical today."

#### T002 — Shared case rules: strict diff parser, draft validator, finding skeleton (both copies)
- Area: backend
- Agent: implementer
- Depends on: T001
- Files (exclusive):
  - `server/src/vendor/shared/contracts/eval-case.ts` (new)
  - `client/src/vendor/shared/contracts/eval-case.ts` (new)
  - `server/src/vendor/shared/index.ts` (modified)
  - `client/src/vendor/shared/index.ts` (modified)
  - `server/test/eval-case-rules.test.ts` (new)
- Skills: zod → parse-never-trust-json, parse-use-safeparse, schema-use-enums, type-export-schemas-and-types; onion-architecture → §2, §9; security → Framework Security Quirks (JavaScript/Node.js), A05; typescript-expert → Code Review Checklist
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - `eval-case.ts` imports only `zod` and `./eval-ci.js` / `./findings.js`; no Node API, no `Date`, no I/O — `contracts-are-the-core` must stay green — onion-architecture §9, §2
  - The two copies are byte-identical (`diff -q` silent); both barrels gain the same one line `export * from './contracts/eval-case.js';` — onion-architecture §4 (schema the client also uses)
  - `parseCaseDiff` follows Assumption A2 exactly (allowed header prefixes, `\` lines uncounted, empty line inside an unfinished hunk = context, mismatch reported at the hunk header line, stray line at its own line, path from `+++ b/` or `--- a/` for `/dev/null`, CRLF tolerated) and stops at the FIRST issue — security §A05 (untrusted input parsed strictly)
  - `newRanges` per hunk is `[newStart, newStart + newCount − 1]` when `newCount > 0`; `lines` carries every source line with its kind and new-side number for the preview — onion-architecture §2 (pure domain data)
  - Expected output: length check first (`expectedOutputChars`), then `JSON.parse` inside `try/catch` (`json_syntax`), then shape checks with `EvalExpectedFinding.safeParse` mapped to the closed issue codes (`unrecognized_keys` → `json_unknown_key` with `key`; missing → `json_missing_key`; enum → `json_bad_severity` / `json_bad_category`; title → `json_bad_title`), then agreement with the expectation (`json_mismatch` with `key` = `file`, `start_line` or `end_line`) — zod §parse-never-trust-json, §parse-use-safeparse
  - Unknown keys are found on `Object.keys` of the parsed object, so an own `__proto__` key from `JSON.parse` is reported, and no parsed value is ever spread or merged into another object — security §Framework Security Quirks (prototype pollution)
  - Regexes are anchored and linear (`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`, `^[a-z0-9-]+$`); none is built from user text — security §Framework Security Quirks (ReDoS)
  - Name rules: empty → `required`; > 60 → `too_long`; outside `EVAL_CASE_NAME_PATTERN` → `name_charset`; in `otherNames` → `name_taken` — the caller decides which names are "other" (A1) — security §A05
  - Expectation rules: file not among parsed paths → `file_not_in_diff`; `start_line < 1` → `start_below_one`; `start_line > end_line` → `start_after_end`; inclusive range intersecting none of the file's `newRanges` → `lines_outside_hunks`; skipped while the diff itself has an issue — onion-architecture §2
  - Explicit return types; issue objects built only from the closed enums; no `any` — typescript-expert §Code Review Checklist
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - Every name in Design › Contracts (`eval-case.ts` part): `EVAL_CASE_LIMITS`, `EVAL_CASE_NAME_PATTERN`, `EvalCaseIssueField`, `EvalCaseIssueCode`, `EvalCaseIssue`, `EvalCaseDraft`, `CaseDiffLine`, `CaseDiffFile`, `CaseDiffParse`, `CaseDraftCheck` — exported here
  - `parseCaseDiff(text: string): CaseDiffParse` — exported here
  - `validateCaseDraft(draft: EvalCaseDraft, otherNames: readonly string[]): CaseDraftCheck` — exported here
  - `findingSkeleton(expectation: EvalCaseDraft['expectation']): string` — exported here
- Steps:
  1. Test first (`eval-case-rules.test.ts`): EC1 header-only diff (`---`/`+++`, no `diff --git`) parses with one file and its +/− counts; EC2 a 120,000-character diff → `too_long` with the line of character 100,001; EC3 `@@ -10,7 +10,7 @@` with 5 new-side lines → `diff_hunk_count_mismatch` at the header line; EC4 `random text` between two hunks → `diff_stray_line` at its line; empty → `required` line 1; EC5 three files listed; EC6 expectation line 300 vs hunk 10–17 → `lines_outside_hunks`; EC7 an object without the array → `json_not_array`; EC8 `__proto__` and `instructions` keys → `json_unknown_key`; EC9 `start_line` 12 vs 14 → `json_mismatch` key `start_line`; EC10 `must_not_flag` with a finding → `json_must_be_empty`; EC11 name in `otherNames` → `name_taken`; title 301 → `pr_title` `too_long`; `findingSkeleton` round-trips through `JSON.parse` with severity WARNING, category bug, empty title. Run red.
  2. Implement `eval-case.ts`, copy it, add the barrel lines.
- Acceptance criteria:
  - SPEC-06 AC2: the parse lists every changed file with added / removed counts and gives each line its kind and new-side number.
  - SPEC-06 AC3, AC4, AC5, AC6, AC8: every refusal reason exists as a closed issue with the first offending line where AC3 asks for it; AC7: the skeleton is pinned.
  - One function serves both the editor and the server (spec NFR Validation parity); `diff -q` of the two `eval-case.ts` copies is silent.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh server server/src/vendor/shared/contracts/eval-case.ts server/src/vendor/shared/index.ts server/test/eval-case-rules.test.ts`
  - `scripts/verify-task.sh client client/src/vendor/shared/contracts/eval-case.ts client/src/vendor/shared/index.ts`
  - `diff -q server/src/vendor/shared/contracts/eval-case.ts client/src/vendor/shared/contracts/eval-case.ts` · `diff -q server/src/vendor/shared/index.ts client/src/vendor/shared/index.ts` (both silent)
  - `cd reviewer-core && npm run typecheck` (it aliases the server `vendor/shared`)
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "`diff -r` over the two `vendor/shared` copies is NOT a drift gate." — Rule: after changing a contract, diff ONLY the files you touched … — `INSIGHTS.md` (2026-09-19)
  - "`typecheck` in `server/` and `reviewer-core/` never type-checks `test/`" — Rule: … type-check them separately with a scratch tsconfig … (`"rootDir": ".."` for server). — `INSIGHTS.md` (2026-09-26, 2026-10-03)
  - Spec NFR Validation parity: "Every rule in AC3, AC4, AC5, AC6 and AC8 is enforced by the server on every save, whatever the client sends; the editor shows the same rules while typing so a valid form never fails on save for a rule it could have shown."
  - Spec NFR Sizes: "PR title at most 300 characters, a limit new to this spec (SPEC-04 caps no frozen title), and description at most 4,000 characters, as SPEC-04 AC4; both optional (AC4)". `prTitleChars` applies to the editor draft only.
  - Spec Untrusted inputs: "Expected output JSON typed by the user — size-capped; only the listed keys and values accepted, unknown keys (including `__proto__`) refused; must agree with the expectation."

#### T003 — Pure domain rules: content change, finding-case expected output, last-run pick, skill injection, agent-run guard
- Area: backend
- Agent: implementer
- Depends on: T001
- Files (exclusive):
  - `server/src/domain/evals/case-editor.ts` (new)
  - `server/src/domain/evals/run-owner.ts` (new)
  - `server/test/eval-case-editor.test.ts` (new)
- Skills: onion-architecture → §2, §3, §5 Domain, §8, §9; typescript-expert → Code Review Checklist
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - Both files import only `@devdigest/shared` and `src/domain/**`; no module, platform, clock or LLM type — `domain-is-pure` — onion-architecture §9
  - `revisionContentChanged` compares diff text, PR title, PR description, expectation type, file, start and end line, and expected output (canonical JSON of the array); it ignores `inputFiles` (derived from the diff) and the name (SPEC-06 AC11, EC13) — onion-architecture §5 Domain
  - `expectedOutputFromProvenance` returns `[]` for `must_not_flag` and one `EvalExpectedFindingView` from the provenance's severity, category and title plus the expectation's file and lines for `must_find` (A4) — onion-architecture §5 Domain
  - `pickLastRun` turns a finished check into `{ source: 'check', … }` (a `running` check is no candidate) and returns the candidate with the later `finished_at`, or `null` (A3) — onion-architecture §5 Domain
  - `withSkillForRun` returns a NEW config: when the skill is in `config.skills`, that entry gets `link_enabled: true`, `skill_enabled: true`, the current `version`, `name`, `description` and `body` at its existing `order`; otherwise it is appended with `order = max(order) + 1` (0 when empty); the input is not mutated (SPEC-06 AC19, EC19, EC20) — onion-architecture §5 Domain
  - `isAgentRunRow` is a type guard on `agentId !== null`, used by repositories instead of a `!` assertion — onion-architecture §5 Domain
  - Tests need no container, DB or network — onion-architecture §8
  - Explicit return types, no `any`, no non-null assertion — typescript-expert §Code Review Checklist (Type Safety)
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `interface RevisionContentLike { inputDiff: string; inputMeta: EvalCaseInputMeta; expectationType: EvalExpectationType; expectation: EvalExpectation; expectedOutput: EvalExpectedOutput | null }` — exported here
  - `revisionContentChanged(prev: RevisionContentLike, next: RevisionContentLike): boolean` — exported here
  - `expectedOutputFromProvenance(type: EvalExpectationType, expectation: EvalExpectation, provenance: EvalCaseProvenance): EvalCaseDetail['expected_output']` — exported here
  - `pickLastRun(check: EvalCaseCheck | null, runResult: EvalCaseLastRun | null): EvalCaseLastRun | null` — exported here
  - `withSkillForRun(config: EvalRunConfig, skill: { id: string; name: string; description: string; body: string; version: number }): EvalRunConfig` — exported here
  - `isAgentRunRow<T extends { agentId: string | null }>(row: T): row is T & { agentId: string }` — exported here (from `run-owner.ts`)
- Steps:
  1. Test first: a name-only difference → `false`; a changed end line → `true`; `must_find` provenance → one finding with the provenance title; a finished check at 10:05 vs a run result at 10:00 → the check; a running check and a run result → the run result; both null → null; EC19 — the skill linked at order 1 with `link_enabled: false` → enabled at order 1 with the new body; EC20 — not linked, others at 0 and 2 → appended at order 3; the input config is unchanged afterwards; `isAgentRunRow` narrows. Run red.
  2. Implement both files.
- Acceptance criteria:
  - SPEC-06 AC11 (what counts as a content change), AC15 (newer of check and run result) and AC19 (skill on for that run at its position or after the others) are decided by these pure functions.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh server server/src/domain/evals/case-editor.ts server/src/domain/evals/run-owner.ts server/test/eval-case-editor.test.ts`
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - `server/specs/skills.md` S2: "Prompt = system prompt + the skills that are on at both levels, in `agent_skills.order`." — a skill eval run turns the measured skill on for that run only (SPEC-06 AC19), never in `agent_skills`.
  - Spec EC13: "Only the name of a manual case is changed — no new revision and no 'edited since last run'."
  - "`typecheck` in `server/` … never type-checks `test/`" — Rule: type-check tests separately with a scratch tsconfig (`"rootDir": ".."` for server). — `INSIGHTS.md` (2026-09-26, 2026-10-03)

#### T004 — Schema change (skill ownership, expected output, checks, remembered agent, skill runs) + migration 0019 + agent-run readers narrowed
- Area: backend
- Agent: implementer
- Depends on: T001, T003
- Files (exclusive):
  - `server/src/db/schema/eval.ts` (modified)
  - `server/src/db/schema.ts` (modified)
  - `server/src/db/migrations/0019_*.sql` (generated by `pnpm run db:generate`)
  - `server/src/db/migrations/meta/_journal.json` (generated by `pnpm run db:generate`)
  - `server/src/db/migrations/meta/0019_snapshot.json` (generated by `pnpm run db:generate`)
  - `server/src/modules/evals/repository.ts` (new by the SPEC-04 plan T006; modified here)
  - `server/src/modules/eval-dashboard/repository/dashboard.repo.ts` (new by the SPEC-05 plan T005; modified here)
  - `server/src/modules/eval-dashboard/repository/promotion.repo.ts` (new by the SPEC-05 plan T006; modified here)
- Skills: postgresql-table-design → Core Rules, Constraints, Indexing, PostgreSQL "Gotchas", Upsert-Friendly Design, Safe Schema Evolution; drizzle-orm-patterns → references/schema-definition.md (Indexes and Constraints), references/migrations.md, references/queries-joins-aggregations.md (Query Operators); onion-architecture → §5 Infrastructure; typescript-expert → Code Review Checklist
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - The two new tables carry `workspace_id uuid NOT NULL` → `workspaces.id` ON DELETE CASCADE — postgresql-table-design §Core Rules + server CLAUDE.md
  - FK actions exactly as Design › Database: skill → cases, skill runs, remembered agent CASCADE; case and revision → checks CASCADE; `via_agent_id` and `skill_eval_agents.agent_id` SET NULL; `eval_suite_runs.agent_id` keeps CASCADE and only loses NOT NULL — postgresql-table-design §Constraints
  - Every FK column has an index (`eval_cases (workspace_id, skill_id)`, `eval_suite_runs (skill_id, started_at)`, `(via_agent_id)`, `eval_case_checks (case_id)` + the revision UNIQUE, `skill_eval_agents (agent_id)`) — postgresql-table-design §PostgreSQL "Gotchas" (FK indexes are manual)
  - Partial unique indexes `eval_suite_runs_one_running_skill_uq (skill_id) WHERE status = 'running'` and `eval_case_checks_one_running_uq (case_id) WHERE status = 'running'`; the full `eval_case_checks_revision_uq (case_revision_id)` is the upsert target (a partial index cannot be one); the SPEC-04 `eval_cases_owner_name_uq` stays as it is — no second name index — postgresql-table-design §Indexing (Partial), §Upsert-Friendly Design
  - Types: `timestamp(..., { withTimezone: true })`, `doublePrecision` nullable cost, jsonb typed with `.$type<EvalExpectedOutput>()`; FK references as arrow functions (`() => skills.id`) — postgresql-table-design §Data Types; drizzle-orm-patterns §Constraints and Warnings
  - Add `evalCaseChecks` and `skillEvalAgents` to the `schema` object in `server/src/db/schema.ts` next to `evalCases` — onion-architecture §5 Infrastructure (db/** owns the schema)
  - One `cd server && pnpm run db:generate` pass; read the SQL: two CREATE TABLE, the ADD COLUMNs, one `ALTER COLUMN "agent_id" DROP NOT NULL`, the partial indexes with their WHERE, no DROP COLUMN, no change to `eval_cases_owner_name_uq`; on any rename prompt stop and report; never edit a generated file — drizzle-orm-patterns §migrations.md; postgresql-table-design §Safe Schema Evolution
  - Narrowing, behaviour unchanged for agent runs: every SPEC-04 / SPEC-05 read of `eval_suite_runs` that serves an agent view adds `isNotNull(t.evalSuiteRuns.agentId)` to its WHERE (dashboard lists, latest-per-agent, running map, recall samples, recent runs, stored run, `listRuns`, `getRun`); rows are narrowed with `isAgentRunRow`, never `!`; the unscoped boot reads `runningRuns()` / `lastResultAt()` stay unfiltered so skill runs are reaped too; `getRun`'s narrowing is temporary — T023 (Wave 4) widens it for skill runs (A9) — drizzle-orm-patterns §Query Operators; typescript-expert §Code Review Checklist
  - Fix only the TS errors caused by the nullable `agentId`; no other edit in the three repository files — onion-architecture §5 Infrastructure
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - Drizzle tables `t.evalCases` (+ `skillId`), `t.evalCaseRevisions` (+ `expectedOutput`), `t.evalSuiteRuns` (`agentId` nullable; + `skillId`, `skillVersion`, `viaAgentId`, `agentName`), `t.evalCaseChecks` (`id`, `workspaceId`, `caseId`, `caseRevisionId`, `status`, `startedAt`, `finishedAt`, `durationMs`, `expected`, `got`, `error`, `costUsd`, `findingsReturned`, `findingsGrounded`, `findingsMatching`), `t.skillEvalAgents` (`skillId`, `workspaceId`, `agentId`, `agentName`, `updatedAt`) — exported here
  - `isAgentRunRow<T extends { agentId: string | null }>(row: T): row is T & { agentId: string }` (from T003)
- Steps:
  1. Test first: run the SPEC-04 / SPEC-05 eval it-tests as the baseline (`server/test/eval-runs.it.test.ts`, `server/test/eval-dashboard.it.test.ts`) and note they pass.
  2. Edit `eval.ts` (import `skills` from `./skills`), the `schema` object, run `db:generate`, read the SQL.
  3. Narrow the three repository files; re-run the same it-tests (the migration applies on a fresh Postgres there) and `pnpm run arch:check`.
- Acceptance criteria:
  - SPEC-06 AC23: the FKs delete a skill's cases, revisions, checks, runs and remembered agent with the skill, and keep a skill run (with `agent_name`) when only its via agent is deleted.
  - SPEC-06 AC15, AC16: one newest check per revision and one running check per case are enforced by unique indexes; SPEC-06 AC18, AC20: the remembered agent and the skill-run record (skill id and version, via agent id and name) have columns.
  - Agent views and dashboards read only rows with `agent_id IS NOT NULL`; the SPEC-04 / SPEC-05 it-tests stay green.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh server server/src/db/schema/eval.ts server/src/db/schema.ts server/src/modules/evals/repository.ts server/src/modules/eval-dashboard/repository/dashboard.repo.ts server/src/modules/eval-dashboard/repository/promotion.repo.ts`
  - `grep -c "eval_case_checks_one_running_uq" server/src/db/migrations/0019_*.sql` (≥ 1) · `grep -ci "drop column" server/src/db/migrations/0019_*.sql` (0) · `grep -ci "drop not null" server/src/db/migrations/0019_*.sql` (1) · `grep -c "eval_cases_owner_name_uq" server/src/db/migrations/0019_*.sql` (0)
  - `cd server && TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run test/eval-runs.it.test.ts test/eval-dashboard.it.test.ts --reporter=dot --silent`
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "A single `pnpm db:generate` that both DROPS a column and ADDS several new ones on the same table triggers an interactive 'is this a rename?' prompt …" — Rule: split the change into two `db:generate` passes … Never try to answer the prompt. — `server/INSIGHTS.md` (2026-09-22). This change drops nothing; one pass.
  - "A Drizzle `text(col, {enum:[...]})` hint is NOT a DB constraint" — Rule: … confirm the CREATE TABLE has no CHECK constraint … — `server/INSIGHTS.md` (2026-09-22). Check statuses are guarded by the contract enum and the code that writes them.
  - "Grepping `pgTable('name'` silently UNDERCOUNTS the schema." — Rule: … read the barrel `src/db/schema.ts` and each file's exports. — `server/INSIGHTS.md` (2026-09-20)
  - "`pnpm exec vitest run .it.test` is flaky in a sandboxed shell" — Rule: set `TESTCONTAINERS_RYUK_DISABLED=true` … and just retry on `CONNECT_TIMEOUT`. — `server/INSIGHTS.md` (2026-09-22)
  - Spec NFR Concurrency and rate: "a skill run does not block, and is not blocked by, the picked agent's own run."

#### T005 — `eval` and `skills` message keys for the editor, rows and the skill Evals tab
- Area: frontend
- Agent: implementer
- Depends on: —
- Files (exclusive):
  - `client/messages/en/eval.json` (modified)
  - `client/messages/en/skills.json` (modified)
- Skills: frontend-ui-architecture → §3 (User-facing strings), §8; security → Framework Security Quirks (React); `client/CLAUDE.md` (Non-default conventions)
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - Add exactly the keys of Design › i18n keys, same nesting and English text; keep every existing key and its text (the SPEC-04 / SPEC-05 additions and the `c7fd204` restyle keys included) — frontend-ui-architecture §3; client CLAUDE.md (placeholder namespaces are not deleted)
  - `caseEditor.tabs.files` goes inside the existing `caseEditor.tabs` object next to `diff` and `prMeta`; `evalsTab.editedSinceLastRun` inside the existing `evalsTab` — frontend-ui-architecture §3
  - Counted strings use ICU plural exactly as pinned (`lastRun.expectedGot`) — frontend-ui-architecture §3
  - Values are plain ICU text: no HTML, no markdown, no rich-text tags; the "−" and "→" are the literal Unicode characters — security §Framework Security Quirks (React escaping is the defence)
  - Both files stay valid JSON with 2-space indentation, English only — frontend-ui-architecture §8
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - The keys of Design › i18n keys — exported here
- Steps:
  1. Test first: the key check below fails before the edit.
  2. Add the keys; run the check from the repository root: `node -e "const e=require('./client/messages/en/eval.json'),s=require('./client/messages/en/skills.json');const g=(o,k)=>k.split('.').reduce((a,p)=>a&&a[p],o);for(const k of ['caseEditor.tabs.files','caseEditor.issues.input_diff.diff_stray_line','caseEditor.lastRun.expectedGot','caseEditor.runBlocked.rateLimited','evalsTab.editedSinceLastRun','skillEvals.picker.missing','skillEvals.historyVia','caseEditor.newCase','caseEditor.validJson'])if(g(e,k)===undefined)throw new Error(k);for(const k of ['detail.tabs.evals','detail.runOnEvals'])if(g(s,k)===undefined)throw new Error(k)"`.
- Acceptance criteria:
  - SPEC-06 AC1, AC17: every label the editor, rows and skill tab need ("New eval case", the three input tabs, Run on save, Cancel / Run case / Save, "Evals", "Run on evals", "via <agent>", "Change agent") exists; existing keys are unchanged.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh client client/messages/en/eval.json client/messages/en/skills.json`
  - the `node -e` key check in Steps (no output)
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - Spec NFR i18n: "Every label comes from the `eval` namespace (`client/messages/en/eval.json`, which already holds `caseEditor` and `evalsTab` keys) or the `skills` namespace for the tab label; English only."
  - `client/CLAUDE.md` › Non-default conventions: "Message namespaces exist for features that are not built yet … They are placeholders for later lessons — do not delete them."

### Wave 1 — parallel

#### T006 [P] — `EvalCaseRepository`: cases per owner, revisions, name-clash mapping, single-case checks
- Area: backend
- Agent: implementer
- Depends on: T001, T004
- Files (exclusive):
  - `server/src/modules/evals/repository/case.repo.ts` (new)
- Skills: drizzle-orm-patterns → references/queries-joins-aggregations.md (Select, Joins, Query Operators), references/transactions.md (Basic Transaction, Transaction with Return Value, Transaction Error Handling), references/common-patterns.md (Upsert); onion-architecture → §5 Infrastructure, §6, §11; postgresql-table-design → Upsert-Friendly Design; security → A01
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - Every method takes `workspaceId` (or a check id it wrote) and filters on it; owner methods also filter `owner_kind` + `agent_id` / `skill_id`, so a skill case under an agent's route is `undefined` (SPEC-06 AC24, EC25) — security §A01; onion-architecture §5 Infrastructure
  - It returns contract types or `editor-types.ts` interfaces, never raw rows; dates leave as ISO strings in contract types; it imports nothing from services, routes, the container or another module — onion-architecture §5 Infrastructure
  - `listCases` uses a fixed number of queries whatever the case count: cases + current revision (one `selectDistinctOn` or `max(revision)` subquery), the owner's latest `completed` run (agent: `agent_id = $id AND skill_id IS NULL`; skill: `skill_id = $id`), its result rows by `inArray(caseId)`, the checks by `inArray(caseRevisionId)` — onion-architecture §11 (no N+1); drizzle-orm-patterns §Joins
  - `getCase` returns `StoredCaseView`: `runResult` only when that run's result row has `case_revision_id` = the current revision (A3), with `finished_at` = the result's `ran_at`, `expected` from SPEC-04's `expectedCount`; `check` = the row of the current revision — drizzle-orm-patterns §Select
  - `insertManualCase` runs in ONE `this.db.transaction(async (tx) => …)`: insert the case (`owner_kind`, `owner_id`, `agent_id` or `skill_id`, no `source_finding_id`, no `provenance`) and its revision 1, every statement on `tx`, returning the case id; a `23505` on `eval_cases_owner_name_uq`, caught OUTSIDE the callback after the rollback, returns `null` (A1); other errors rethrow — drizzle-orm-patterns §Transaction with Return Value, §Transaction Error Handling; onion-architecture §6
  - `updateCase` runs in ONE transaction: update the name; when `content` is set insert a revision with `revision = (select coalesce(max(revision), 0) + 1 …)`; a `23505` on `eval_case_revisions_case_rev_uq` returns `'conflict'` (A13), a `23505` on `eval_cases_owner_name_uq` returns `'name_taken'` (A1), both after the rollback; no statement updates or deletes a revision row — drizzle-orm-patterns §Transaction Error Handling; onion-architecture §6
  - `startCheck` is one statement: insert `running` with `onConflictDoUpdate({ target: t.evalCaseChecks.caseRevisionId, set: {status 'running', started_at now(), finished_at/got/error/cost null}, setWhere: status <> 'running' })` returning `id`; no row returned, or a `23505` on `eval_case_checks_one_running_uq`, → `null`; other errors rethrow — postgresql-table-design §Upsert-Friendly Design; drizzle-orm-patterns §Upsert
  - `finishCheck` updates only the row with that id and `status = 'running'`; `failRunningChecks` closes every `running` check as `errored` with the given reason and returns the count (boot only, unscoped like SPEC-04's `runningRuns`) — onion-architecture §5 Infrastructure
  - `caseNames` returns `{ id, name }` of the owner's cases in one query; `ownerName` reads the agent or skill row in the workspace — onion-architecture §11
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `class EvalCaseRepository { constructor(db: Db) }` — exported here
  - `ownerName(workspaceId: string, owner: EvalCaseOwner): Promise<string | undefined>` — exported here
  - `caseNames(workspaceId: string, owner: EvalCaseOwner): Promise<{ id: string; name: string }[]>` — exported here
  - `listCases(workspaceId: string, owner: EvalCaseOwner): Promise<EvalCaseListItem[]>` — exported here
  - `getCase(workspaceId: string, owner: EvalCaseOwner, caseId: string): Promise<StoredCaseView | undefined>` — exported here
  - `insertManualCase(values: NewManualCase): Promise<string | null>` (null = the name is taken in the set; nothing written) — exported here
  - `updateCase(values: CaseUpdate): Promise<CaseUpdateOutcome>` — exported here
  - `caseForRun(workspaceId: string, owner: EvalCaseOwner, caseId: string): Promise<CaseForRun | undefined>` — exported here
  - `startCheck(values: CheckStart): Promise<string | null>` — exported here
  - `finishCheck(checkId: string, values: CheckFinish): Promise<void>` — exported here
  - `failRunningChecks(reason: string, finishedAt: Date): Promise<number>` — exported here
- Steps:
  1. Implement the class (behaviour is proved against real Postgres by T016 and T019; no own test file, per TESTING.md "one real integration per data-backed workflow").
  2. `pnpm run arch:check` stays green.
- Acceptance criteria:
  - SPEC-06 AC9 (manual case stored with exactly the entered input as revision 1), AC8 (a name taken in the set reported as `null` / `'name_taken'`, nothing written), AC11 (rename vs new revision), AC15 (newest check per revision, run result of the current revision), AC16 (one running check per case), AC24 (owner + workspace scoping) are supported with the exact signatures above.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh server server/src/modules/evals/repository/case.repo.ts`
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "The codebase's first `db.transaction()` now exists: `AgentsRepository.setSkills`." — Rule: … copy this shape … every statement inside using `tx`, never `this.db`. — `server/INSIGHTS.md` (2026-09-22)
  - "The server has ZERO `db.transaction()` calls; multi-step writes are not atomic." — Rule: any write that … touches more than one table goes in `container.db.transaction(async (tx) => …)` … — `server/INSIGHTS.md` (2026-09-21)
  - "A TYPE-ONLY import of another module's `types.ts` also fails `no-cross-module-imports`" — Rule: NEVER plan a cross-module import, type-only included … — `server/INSIGHTS.md` (2026-09-30)
  - Spec NFR History: "Case revisions are append-only while a run refers to them; the per-case result of a past run never changes after an edit (AC11, AC12)."
  - Spec AC8: "IF the name is empty, longer than 60 characters, contains anything but lowercase letters, digits and hyphens, or equals another case's name in the owner's set, THEN the system shall refuse to save and name the reason."

#### T007 [P] — `SkillEvalRepository`: remembered agent, skill row, skill cases for a run, skill runs, shared skill-run mapper
- Area: backend
- Agent: implementer
- Depends on: T001, T004
- Files (exclusive):
  - `server/src/modules/evals/repository/skill-eval.repo.ts` (new)
- Skills: drizzle-orm-patterns → references/queries-joins-aggregations.md (Select, Joins, Query Operators), references/common-patterns.md (Upsert), references/transactions.md (Transaction Error Handling); onion-architecture → §5 Infrastructure, §9, §11; security → A01; typescript-expert → Code Review Checklist
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - Every method filters on `workspace_id` (skills, agents, cases, runs, remembered agent) — security §A01; onion-architecture §5 Infrastructure
  - It returns contract types or `editor-types.ts` interfaces and imports nothing from services, routes, the container or another module — onion-architecture §5 Infrastructure
  - `skillForRun` reads the skill's current `name`, `description`, `body`, `version` WHATEVER its `enabled` flag (SPEC-06 EC20) — drizzle-orm-patterns §Select
  - `evalAgent` returns `{ agentId, agentName }` from `skill_eval_agents` (agentId null = deleted agent) or `undefined` when never chosen; `setEvalAgent` upserts on `skill_id` (`onConflictDoUpdate`, `updated_at = now()`) — drizzle-orm-patterns §Upsert
  - `casesForSkill` returns `CaseForRun` of every case with `skill_id = $skill`, each at its current revision, in one query — onion-architecture §11
  - `createSkillRun` inserts a `running` `eval_suite_runs` row with `agent_id` NULL, `skill_id`, `skill_version`, `via_agent_id`, `agent_name`, `agent_version`, `config`, `cases`, `cases_total`; a `23505` on `eval_suite_runs_one_running_skill_uq` returns `null`, other errors rethrow — drizzle-orm-patterns §Transaction Error Handling
  - The row → `SkillEvalRunSummary` mapping is ONE exported pure function `toSkillRunSummary(row)` in this file: `agent_id` = `via_agent_id`, `agent_deleted` = (`via_agent_id` is null), `cost_usd` null kept null, `null` when `skill_id`, `skill_version` or `agent_name` is null (not a skill run); `listSkillRuns` orders by `started_at DESC` and maps through it, and T023's `getRun` reuses it (accepted R4) — onion-architecture §5 Infrastructure (row → DTO mappers next to the repository)
  - This file never imports `../repository.js` (T023 imports this file from there; the reverse edge would be a `no-circular` cycle) — onion-architecture §9
  - No `any`; jsonb read through its `$type`; no non-null assertion — typescript-expert §Code Review Checklist
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `class SkillEvalRepository { constructor(db: Db) }` — exported here
  - `skillForRun(workspaceId: string, skillId: string): Promise<SkillForRun | undefined>` — exported here
  - `evalAgent(workspaceId: string, skillId: string): Promise<SkillEvalAgentRow | undefined>` — exported here
  - `setEvalAgent(workspaceId: string, skillId: string, agent: { id: string; name: string }): Promise<void>` — exported here
  - `agentName(workspaceId: string, agentId: string): Promise<string | undefined>` — exported here
  - `casesForSkill(workspaceId: string, skillId: string): Promise<CaseForRun[]>` — exported here
  - `createSkillRun(values: NewSkillRun): Promise<string | null>` — exported here
  - `listSkillRuns(workspaceId: string, skillId: string): Promise<SkillEvalRunSummary[]>` — exported here
  - `toSkillRunSummary(row: typeof t.evalSuiteRuns.$inferSelect): SkillEvalRunSummary | null` — exported here
- Steps:
  1. Implement the class and the mapper (proved against real Postgres by T016, T019 and T023).
  2. `pnpm run arch:check` stays green.
- Acceptance criteria:
  - SPEC-06 AC18 (remembered agent per skill), AC20 (skill id and version, agent id, name and version recorded), AC21 (one running run per skill; the missing agent's name kept), AC22 (history rows with the deleted-agent flag) and AC24 are supported with the exact signatures above; `toSkillRunSummary` is the only skill-run mapping in the module.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh server server/src/modules/evals/repository/skill-eval.repo.ts`
  - `grep -n "repository.js" server/src/modules/evals/repository/skill-eval.repo.ts` (no output)
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "A run's cost is `null` for 'unknown', `0` for 'free' — never conflate them." — Rule: … every cost column/field stays nullable so the UI can render an em dash. — `server/INSIGHTS.md` (2026-09-19)
  - "Drizzle's `count()` is NOT the same hazard as `sum()`: it maps to a number." — Rule: do NOT wrap `count()` in `parseAggregateCost` "for symmetry" … — `server/INSIGHTS.md` (2026-09-19)
  - `server/specs/skills.md` S7: "Every read and write is scoped by `workspace_id`; a skill from another workspace → 404."

#### T008 [P] — Shared run executor: one case through the engine, and the run configuration per owner
- Area: backend
- Agent: implementer
- Depends on: T001, T003
- Files (exclusive):
  - `server/src/modules/evals/run-executor.ts` (new)
  - `server/test/eval-run-executor.test.ts` (new)
- Skills: onion-architecture → §5 Application, §7, §8; security → A01, A09, Agentic AI Security; typescript-expert → Code Review Checklist (Error Handling Patterns)
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - The file never imports `service.ts`, `Container`, drizzle, `db/*` or `adapters/**`; its deps are the structural `CaseRunnerDeps` and `RunConfigPorts` below (importing `service.ts` would be a cycle once the service imports this file) — onion-architecture §5 Application
  - `runCaseReview` moves SPEC-04's per-case body as is: resolve `deps.llm(config.provider)` inside the try; `reviewPullRequest({ systemPrompt, model, diff: deps.parseDiff(c.inputDiff), llm, strategy, skills: skillBlocks(config.skills), prDescription: c.inputMeta.pr_description || undefined, task: evalTaskLine(c.inputMeta.pr_title), sessionId })` inside `withTimeout(…, EVAL_CASE_TIMEOUT_MS)`; then `scoreCase(...)` — security §Agentic AI Security (untrusted input only through the engine's guarded slots)
  - The case `name`, notes and expected output never reach the engine call or a log line (SPEC-06 AC25) — security §A09, Agentic AI Security
  - It never throws: any error → `{ status: 'errored', error: errorReason(err), costUsd: null, … }` with the measured `durationMs` (SPEC-06 AC14 "the reason for an errored case") — typescript-expert §Code Review Checklist (Error Handling Patterns)
  - Prompt records keep SPEC-04's shape (`component: 'reviewer'`, `correlation: { run_id: ctx.correlationId, agent: ctx.agentName }`) when `promptLogMode !== 'off'` — security §A09
  - `resolveRunConfig` for an agent owner: `agentConfigSource` (undefined → `NotFoundError`) → `buildRunConfig`; for a skill owner: `skillForRun` (undefined → `NotFoundError`) → `evalAgent` (undefined → `AppError('eval_agent_required', …, 422)`; `agentId` null → `AppError('eval_agent_missing', …, 422, { agent_name })`) → `agentConfigSource` of that agent (undefined → `eval_agent_missing`) → `buildRunConfig` → `withSkillForRun` — onion-architecture §7
  - Workspace scope is passed to every port call; no model call happens before every check above passed (SPEC-06 AC24) — security §A01
  - Unit tests use fake deps (`MockLLMProvider` with a structured `Review` fixture) and no DB — onion-architecture §8
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `interface CaseRunnerDeps { llm: (provider: Provider) => Promise<LLMProvider>; parseDiff: (raw: string) => UnifiedDiff; tokenizer: { count(text: string): number }; promptLogMode: PromptLogMode; now?: () => Date }` — exported here
  - `interface CaseRunContext { correlationId: string; agentName: string; logger: EvalLogger }` — exported here
  - `runCaseReview(deps: CaseRunnerDeps, config: EvalRunConfig, c: CaseForRun, ctx: CaseRunContext): Promise<CaseOutcome>` — exported here
  - `interface RunConfigPorts { agentConfigSource(workspaceId: string, agentId: string): Promise<AgentConfigSource | undefined>; skillForRun(workspaceId: string, skillId: string): Promise<SkillForRun | undefined>; evalAgent(workspaceId: string, skillId: string): Promise<SkillEvalAgentRow | undefined> }` — exported here
  - `resolveRunConfig(ports: RunConfigPorts, workspaceId: string, owner: EvalCaseOwner): Promise<ResolvedRunConfig>` — exported here
  - Uses `withSkillForRun(config: EvalRunConfig, skill: { id: string; name: string; description: string; body: string; version: number }): EvalRunConfig` (from T003); SPEC-04's `buildRunConfig`, `skillBlocks`, `evalTaskLine`, `errorReason`, `EVAL_CASE_TIMEOUT_MS`, `scoreCase`
- Steps:
  1. Test first (`eval-run-executor.test.ts`): a scripted provider returning one matching finding → `passed`, `findingsMatching: 1`; the recorded request contains the diff and the PR title, and contains neither the case name nor the expected title; `llm()` throwing `ConfigError` (EC18) → `errored` with the reason and `costUsd: null`; skill owner with no remembered agent → 422 `eval_agent_required`; remembered agent deleted → 422 `eval_agent_missing` with `agent_name`; skill linked but disabled → the resolved config has it enabled at its order; agent owner → config without a skill change. Run red.
  2. Implement `run-executor.ts`.
- Acceptance criteria:
  - SPEC-06 AC14 (one case with the owner's current configuration, reason when errored), AC19 (skill config through the remembered agent), AC25 (only diff, title and description reach the model) hold at the executor level.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh server server/src/modules/evals/run-executor.ts server/test/eval-run-executor.test.ts`
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "A NEW module that needs another module's SERVICE … trips `arch:check`'s `no-circular` …" — Rule: … retype its parameter … to a minimal structural interface … — `server/INSIGHTS.md` (2026-09-22)
  - "`maxRetries: 0` on `completeStructured` is NOT 'one HTTP request'." — Rule: … count answered attempts, not HTTP requests … — `server/INSIGHTS.md` (2026-10-04). The engine's default re-asks stay on (spec NFR Model calls: "re-asks included").
  - `reviewer-core/CLAUDE.md`: "`INJECTION_GUARD` in `src/prompt.ts` is the single trusted defense against prompt injection. Do **not** add keyword or denylist scanning of untrusted text." (EC26)
  - `server/specs/review-flow.md` invariant 6: "Every prompt sent produces one content-free `prompt.assembled` record … never a secret, diff line or spec/skill body."

#### T009 [P] — Client hooks and cache keys for cases, single-case runs, skill runs and the remembered agent
- Area: frontend
- Agent: implementer
- Depends on: T001
- Files (exclusive):
  - `client/src/lib/hooks/eval-cases.ts` (new)
  - `client/src/lib/hooks/eval-cases.test.tsx` (new)
  - `client/src/lib/hooks/keys.ts` (modified)
  - `client/src/lib/hooks/index.ts` (modified)
- Skills: frontend-ui-architecture → §3, §4, §6; react-best-practices → Data Fetching, Derive Don't Store, Hooks; react-testing-library → Hook Testing, Async Testing, Mocking Strategies; `client/docs/ui-architecture.md` (Cache keys, Error-UX taxonomy)
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - All requests go through `api` from `src/lib/api.ts`; body-less POSTs (`check`, skill `eval-runs`) call `api.post(path)` with no body — frontend-ui-architecture §4; client CLAUDE.md (`apiFetch` content-type rule)
  - New keys only in the factory: `evalCase: (kind, ownerId, caseId) => ["eval-case", kind, ownerId, caseId]`, `evalCasesAll: () => ["eval-case"]`, `skillEvalCases: (skillId) => ["skill-eval-cases", skillId]`, `skillEvalRuns: (skillId) => ["skill-eval-runs", skillId]`, `skillEvalAgent: (skillId) => ["skill-eval-agent", skillId]`; the agent list keeps SPEC-04's `agentEvalCases(agentId)` — client/docs/ui-architecture.md §Cache keys
  - `useEvalCase` polls every 2000 ms while `data.check?.status === "running"`; `useSkillEvalRuns` while any run is `running`; `useSkillEvalCases` takes the same `{ refetchIntervalMs }` option as SPEC-04's `useAgentEvalCases` (NFR Latency ≤ 5 s) — react-best-practices §Data Fetching
  - Save (create / update) invalidates the owner's list key and `evalCase(...)` of that case and sets the returned detail into the cache; a check start invalidates both; a skill run start invalidates `skillEvalRuns` and `skillEvalCases`; `useSetSkillEvalAgent` sets `skillEvalAgent` from the answer; `useDeleteSkillEvalCase` invalidates `skillEvalCases` — client/docs/ui-architecture.md §Cache keys
  - Mutations keep the global toast: no `onError` override (refusals also toast, user decision) — client/docs/ui-architecture.md §Error-UX taxonomy
  - Server state stays in the query cache; no hook mirrors data into `useState` — react-best-practices §Derive, Don't Store
  - The barrel adds `export * from "./eval-cases"` like its siblings — frontend-ui-architecture §6
  - The test mocks `@/lib/api` by alias, wraps a fresh `QueryClientProvider`, uses `renderHook` + `waitFor`, no fixed delays — react-testing-library §Hook Testing, §Mocking Strategies, §Async Testing
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `useEvalCase(owner: EvalCaseOwner, caseId: string | null): UseQueryResult<EvalCaseDetail, Error>` — exported here
  - `useCreateEvalCaseDraft(owner: EvalCaseOwner): UseMutationResult<SaveEvalCaseResponse, Error, EvalCaseDraft>` — exported here
  - `useUpdateEvalCase(owner: EvalCaseOwner): UseMutationResult<SaveEvalCaseResponse, Error, { caseId: string; draft: EvalCaseDraft }>` — exported here
  - `useStartEvalCaseCheck(owner: EvalCaseOwner): UseMutationResult<StartEvalCaseCheckResponse, Error, string>` — exported here
  - `useSkillEvalCases(skillId: string | null | undefined, opts?: { refetchIntervalMs?: number | false }): UseQueryResult<EvalCaseListItem[], Error>` — exported here
  - `useDeleteSkillEvalCase(skillId: string): UseMutationResult<{ ok: true }, Error, string>` — exported here
  - `useSkillEvalRuns(skillId: string | null | undefined): UseQueryResult<SkillEvalRunSummary[], Error>` — exported here
  - `useStartSkillEvalRun(skillId: string): UseMutationResult<StartEvalRunResponse, Error, void>` — exported here
  - `useSkillEvalAgent(skillId: string | null | undefined): UseQueryResult<SkillEvalAgent, Error>` — exported here
  - `useSetSkillEvalAgent(skillId: string): UseMutationResult<SkillEvalAgent, Error, string>` — exported here
- Steps:
  1. Test first (`eval-cases.test.tsx`): `useCreateEvalCaseDraft({ kind: "skill", id: "s1" }).mutate(draft)` posts `/skills/s1/eval-cases` with the draft; `useStartEvalCaseCheck({ kind: "agent", id: "a1" }).mutate("c1")` posts `/agents/a1/eval-cases/c1/check` with no body; `useEvalCase` with a `running` check refetches, without one it does not; `useSetSkillEvalAgent("s1").mutate("ag1")` puts `{ agent_id: "ag1" }`. Run red.
  2. Implement keys, hooks and the barrel line.
- Acceptance criteria:
  - SPEC-06 AC14 / NFR Latency: a single-case result appears without a page reload, refreshed every 2 s while running; after save, run and run-all the lists and the detail refetch.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh client client/src/lib/hooks/eval-cases.ts client/src/lib/hooks/eval-cases.test.tsx client/src/lib/hooks/keys.ts client/src/lib/hooks/index.ts`
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "Moving a component folder breaks `vi.mock("../../…/lib/hooks/x")` in its test …" — Rule: mock module paths with the alias (`vi.mock("@/lib/hooks/reviews", …)`) … — `client/INSIGHTS.md` (2026-09-21)
  - `client/CLAUDE.md` › Non-obvious behavior: "`apiFetch` only sets `content-type: application/json` when a body is actually present."
  - "A green client vitest run is mostly noise with the default reporter." — Rule: … `pnpm exec vitest run <files> --reporter=dot --silent` … — `client/INSIGHTS.md` (2026-10-03)

#### T010 [P] — Case Editor input pieces: Diff / Files / PR meta with preview, expectation fields, expected-output editor
- Area: frontend
- Agent: implementer
- Depends on: T002, T005
- Files (exclusive):
  - `client/src/components/case-editor/DiffInput.tsx` (new)
  - `client/src/components/case-editor/DiffPreview.tsx` (new)
  - `client/src/components/case-editor/ExpectationFields.tsx` (new)
  - `client/src/components/case-editor/ExpectedOutputEditor.tsx` (new)
  - `client/src/components/case-editor/helpers.ts` (new)
  - `client/src/components/case-editor/helpers.test.ts` (new)
  - `client/src/components/case-editor/inputs.test.tsx` (new)
  - `client/src/components/case-editor/styles.ts` (new)
- Skills: frontend-ui-architecture → §3, §4, §5, §8; react-best-practices → Component Design, Derive Don't Store, Conditional Rendering, Accessibility, Key Prop Patterns; react-testing-library → Query Priority, Anti-Patterns; security → A05, Framework Security Quirks (React)
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - The four components render props only (no data hooks; translations allowed); parsing and validation results come in as props from the dialog (T014) — frontend-ui-architecture §4 (tier 4 view)
  - `helpers.ts` is pure: `issueMessageKey(issue)` → `caseEditor.issues.<field>.<code>`, `issueValues(issue)` → `{ line, limit, key }` with `limit` from `EVAL_CASE_LIMITS`, `firstIssue(issues, field)`, `fileLabel(file)` — frontend-ui-architecture §4 (tier 1)
  - Every pasted or typed text (diff lines, paths, titles, JSON) renders as a React text child; no `dangerouslySetInnerHTML`, no `Markdown`, no link built from it — security §A05, §Framework Security Quirks (React)
  - Preview (SPEC-06 AC2): one row per `CaseDiffLine` with the new-side number, the marker "+" / "−" / " " as text AND a colour, headers styled apart; rows keyed by `sourceLine` — react-best-practices §Accessibility (never colour alone), §Key Prop Patterns
  - Diff / Files / PR meta are three tabs (`caseEditor.tabs.*`); Files is a read-only list of `path` with `fileStats` (+N −M), or `filesEmpty` — react-best-practices §Conditional Rendering
  - PR meta: title and description inputs with a visible `counter` (`{count} / {limit}`) under each; over the limit the counter and the field get the issue text linked by `aria-describedby` and `aria-invalid` (SPEC-06 AC4) — react-best-practices §Accessibility
  - Expectation: a type control of two radio inputs (`must_find` / `must_not_flag`), a file select over the parsed files, start / end number inputs, each with a `<label>`; the first expectation issue shows under them — react-best-practices §Accessibility
  - Accessible names the e2e flow (T025) selects by, each also set as `aria-label` with exactly this text: the diff `<textarea>` `caseEditor.tabs.diff` ("Diff"); the file `<select>` `caseEditor.fileLabel` ("File"), its `<option value>` = the file path; the start / end inputs `caseEditor.startLineLabel` / `caseEditor.endLineLabel`; the two radios `evalsTab.expectation.must_find` ("must find") / `evalsTab.expectation.must_not_flag` ("must not flag") (accepted R1) — react-best-practices §Accessibility
  - Expected output: a labelled monospace `<textarea>`, a badge with icon AND text `validJson` / `invalidJson` plus the first issue's message (SPEC-06 AC6); "+ Finding skeleton" calls `onChange(findingSkeleton(expectation))` on `must_find` and is disabled with the visible `skeletonDisabledHint` on `must_not_flag` (SPEC-06 AC7) — react-best-practices §Accessibility
  - `readOnly` disables every input (finding-made cases, SPEC-06 AC10) — react-best-practices §Component Design
  - Inline style objects in `styles.ts`, all-longhand borders on variants; primitives from `@devdigest/ui`; strings only from `eval`; each file < ~200 lines — frontend-ui-architecture §8
  - Tests render with the real `@messages/en/eval.json`, use `fireEvent` and role / label / text queries — react-testing-library §Query Priority, §Anti-Patterns
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `DiffInput(props: { diff: string; prTitle: string; prDescription: string; parse: CaseDiffParse; issues: readonly EvalCaseIssue[]; readOnly: boolean; onChange: (patch: Partial<Pick<EvalCaseDraft, "input_diff" | "pr_title" | "pr_description">>) => void }): JSX.Element` — exported here
  - `ExpectationFields(props: { expectationType: EvalExpectationType; expectation: EvalCaseDraft["expectation"]; files: readonly CaseDiffFile[]; issues: readonly EvalCaseIssue[]; readOnly: boolean; onChange: (patch: Partial<Pick<EvalCaseDraft, "expectation_type" | "expectation">>) => void }): JSX.Element` — exported here
  - `ExpectedOutputEditor(props: { value: string; expectationType: EvalExpectationType; expectation: EvalCaseDraft["expectation"]; issue: EvalCaseIssue | null; readOnly: boolean; onChange: (value: string) => void }): JSX.Element` — exported here
  - `issueMessageKey(issue: EvalCaseIssue): string` · `issueValues(issue: EvalCaseIssue): Record<string, string | number>` · `firstIssue(issues: readonly EvalCaseIssue[], field: EvalCaseIssueField): EvalCaseIssue | null` — exported here (from `helpers.ts`)
  - The accessible names "Diff", "File", "Start line", "End line", "must find", "must not flag" — exported here (used by T025)
  - Uses `parseCaseDiff`, `findingSkeleton`, `EVAL_CASE_LIMITS` (from T002)
- Steps:
  1. Tests first: `helpers.test.ts` — `issueMessageKey` of a stray-line issue → `caseEditor.issues.input_diff.diff_stray_line`, `issueValues` carries its line; `firstIssue` picks the field's issue. `inputs.test.tsx` — a parsed two-file diff shows "+"/"−" markers and both paths with counts in Files; a `<script>` line renders as text; a 301-character title shows "301 / 300" and the issue; `must_not_flag` disables "+ Finding skeleton" with "Nothing is expected for must_not_flag"; clicking it on `must_find` calls `onChange` with the skeleton; an issue shows "invalid JSON" and its message, none shows "valid JSON"; the diff textarea, the file select, the start / end inputs and the two radios are found by `getByLabelText` with the names pinned above. Run red.
  2. Implement helpers, components and styles.
- Acceptance criteria:
  - SPEC-06 AC2 (preview with headers, hunk headers, new-side numbers, "+"/"−" and colour, plain text; Files list with counts), AC3–AC5 (reasons shown with the line), AC4 (counters), AC6 (badge), AC7 (skeleton / disabled hint) are visible in the pieces.
  - The controls carry the accessible names pinned above, asserted by `inputs.test.tsx` (accepted R1).
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh client client/src/components/case-editor/DiffInput.tsx client/src/components/case-editor/DiffPreview.tsx client/src/components/case-editor/ExpectationFields.tsx client/src/components/case-editor/ExpectedOutputEditor.tsx client/src/components/case-editor/helpers.ts client/src/components/case-editor/helpers.test.ts client/src/components/case-editor/inputs.test.tsx`
  - `grep -rnE "dangerouslySetInnerHTML|Markdown" client/src/components/case-editor` (no output)
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "`@testing-library/user-event` is NOT installed; component tests use `fireEvent`." — Rule: use `fireEvent` from `@testing-library/react` … — `client/INSIGHTS.md` (2026-09-26)
  - "`messages/*.json` sits outside `src/`, so `@/` cannot import it; use `@messages/…`." — Rule: import message bundles as `@messages/en/<ns>.json` … — `client/INSIGHTS.md` (2026-09-21)
  - "Mixing the `border` shorthand with a `borderColor` override is a runtime error in dev." — Rule: any style whose variant changes ONE border facet is all-longhand … — `client/INSIGHTS.md` (2026-09-19)
  - Spec NFR Accessibility: "The JSON badge, row states and the last-run strip carry text and icon, never colour alone; diff lines carry '+'/'−'; every editor control is reachable by keyboard."
  - `e2e/docs/flow-authoring.md` › Locator rules: "Because `find role button --name` matches the **accessible name**, a control that a flow needs to click must carry a real `aria-label` rather than only a `title`. That is a UI-side requirement this suite imposes on the app."

#### T011 [P] — Promote the Evals-tab list pieces to shared `eval-suite`, with row actions, "edited since last run" and the single-case line
- Area: frontend
- Agent: implementer
- Depends on: T001, T005
- Files (exclusive):
  - `client/src/components/eval-suite/CaseList.tsx` (new)
  - `client/src/components/eval-suite/MetricCards.tsx` (new)
  - `client/src/components/eval-suite/RunHistory.tsx` (new)
  - `client/src/components/eval-suite/LastRunLine.tsx` (new)
  - `client/src/components/eval-suite/helpers.ts` (new)
  - `client/src/components/eval-suite/helpers.test.ts` (new)
  - `client/src/components/eval-suite/CaseList.test.tsx` (new)
  - `client/src/components/eval-suite/styles.ts` (new)
  - `client/src/components/eval-suite/index.ts` (new)
  - `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/CaseList.tsx` (new by the SPEC-04 plan T010; deleted here)
  - `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/MetricCards.tsx` (new by the SPEC-04 plan T010; deleted here)
  - `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/RunHistory.tsx` (new by the SPEC-04 plan T010; deleted here)
  - `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/helpers.ts` (new by the SPEC-04 plan T010; deleted here)
  - `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/helpers.test.ts` (new by the SPEC-04 plan T010; deleted here)
  - `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx` (new by the SPEC-04 plan T010, edited by the SPEC-05 plan T014; modified here)
  - `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/styles.ts` (new by the SPEC-04 plan T010; modified here)
- Skills: frontend-ui-architecture → §1, §5, §6, §8; react-best-practices → Component Design, Derive Don't Store, Conditional Rendering, Accessibility, Key Prop Patterns; react-testing-library → Query Priority, Mocking Strategies
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - Move, do not copy: the three components and `helpers.ts` / `helpers.test.ts` go to `client/src/components/eval-suite/`, the old files are deleted, `EvalsTab.tsx` imports from `@/components/eval-suite` — no re-export shim at the old path — frontend-ui-architecture §1 (promote on the second consumer), §6
  - Before deleting, `grep -rnE "EvalsTab/(CaseList|MetricCards|RunHistory|helpers)" client/src` and `grep -rn 'vi.mock("\.' client/src/app/(shell)/agents` and update every hit — frontend-ui-architecture §6 (update every import site)
  - Behaviour of the moved helpers stays (the metric formatters too — T024 re-points them to `@/lib/eval-metrics` in Wave 2); their run parameters widen to `{ status, … }`-shaped runs so `SkillEvalRunSummary` fits (`EvalSuiteRunLike = Omit<AgentEvalRunSummary, "agent_id">`); the `c7fd204` `eval-ui` imports move unchanged — frontend-ui-architecture §5
  - `caseRowState(item)` returns `edited` when `latest_result` is set and its `case_revision_id` differs from `item.revision_id` (SPEC-06 AC13), else `never` / `passed` / `failed` / `errored`; an `edited` row shows `evalsTab.editedSinceLastRun` with an icon in place of that run's result; an `errored` row keeps the reason (A2 of the SPEC-04 plan) — react-best-practices §Derive, Don't Store
  - `CaseList` renders props only; per row: edit (`onEdit(item, event.currentTarget)`), run (`onRun`, disabled with `runDisabledReason(item)` as visible text) and delete buttons, each with an accessible name containing the case name; actions whose callback is absent are not rendered — react-best-practices §Accessibility, §Component Design
  - Under a row with a `check`: `LastRunLine` — running → `caseEditor.lastRun.running`; else "Last run passed|failed|errored · expected N finding(s), got M · <n>s · <cost>" with `formatUsd` (em dash for unknown) and the error reason instead of "got M" when errored (SPEC-06 AC14, A5) — react-best-practices §Conditional Rendering
  - `RunHistory` is generic: `<R extends EvalSuiteRunLike>` with an optional `viaLabel(run)` cell for the skill tab; `MetricCards` takes `latest` / `previous` of `EvalSuiteRunLike` — react-best-practices §Component Design
  - List keys are ids — react-best-practices §Key Prop Patterns
  - `EvalsTab.tsx` changes only its imports and the props it passes (`onDelete` as today, no `onEdit` / `onRun` yet); its existing test stays green unchanged — frontend-ui-architecture §6
  - Tests render with the real `eval` bundle, `fireEvent`, role / text queries — react-testing-library §Query Priority, §Mocking Strategies
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `type EvalSuiteRunLike = Omit<AgentEvalRunSummary, "agent_id">` — exported here
  - `CaseList(props: { cases: readonly EvalCaseListItem[]; onDelete: (item: EvalCaseListItem) => void; onEdit?: (item: EvalCaseListItem, trigger: HTMLElement) => void; onRun?: (item: EvalCaseListItem) => void; runDisabledReason?: (item: EvalCaseListItem) => string | null }): JSX.Element` — exported here
  - `MetricCards(props: { latest: EvalSuiteRunLike | null; previous: EvalSuiteRunLike | null }): JSX.Element` — exported here
  - `RunHistory<R extends EvalSuiteRunLike>(props: { runs: readonly R[]; viaLabel?: (run: R) => string }): JSX.Element` — exported here
  - `LastRunLine(props: { lastRun: EvalCaseLastRun | null; running: boolean }): JSX.Element` — exported here
  - `caseRowState(item: EvalCaseListItem): "edited" | "never" | "passed" | "failed" | "errored"` — exported here
  - `checkToLastRun(check: EvalCaseCheck | null): EvalCaseLastRun | null` — exported here
  - `rateLimitedUntil(err: unknown, nowMs: number): number | null` (`ApiError` with code `run_start_rate_limited` → `nowMs + (details.retry_after_ms ?? 60_000)`, A8) — exported here
  - `latestCompleted<R extends { status: EvalRunStatus }>(runs: readonly R[]): R | null` · `previousCompleted<R extends { status: EvalRunStatus }>(runs: readonly R[]): R | null` · `runAllBlocker(cases: readonly unknown[], runs: readonly { status: EvalRunStatus }[]): "noCases" | "inProgress" | null` · `progressOf(run: Pick<AgentEvalRunSummary, "cases_done" | "cases_total">): { done: number; total: number }` — exported here (moved, widened)
- Steps:
  1. Tests first: `helpers.test.ts` (moved, plus) — `caseRowState` with a result at an older revision → `edited`, same revision → its status, none → `never`; `checkToLastRun` of a running check → `null`; `rateLimitedUntil` of a 429 with `retry_after_ms: 30000` → now + 30 s. `CaseList.test.tsx` — an edited row shows "edited since last run" and not "passed"; a row with an errored check shows "Last run errored" and the reason and "—" for an unknown cost; edit / run callbacks fire with the item; `runDisabledReason` "Already running" disables run and shows the text. Run red.
  2. Move the files, generalise, add the row actions and `LastRunLine`, update `EvalsTab.tsx` and `styles.ts`.
- Acceptance criteria:
  - SPEC-06 AC13: a row whose latest completed run covered an earlier revision reads "edited since last run"; a name-only edit never does (EC13, same revision).
  - SPEC-06 AC9: a new case with no result reads "never run"; AC22 (SPEC-06) history and metric cards are reusable by the skill tab; the agent Evals tab renders exactly as before.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh client client/src/components/eval-suite/CaseList.tsx client/src/components/eval-suite/MetricCards.tsx client/src/components/eval-suite/RunHistory.tsx client/src/components/eval-suite/LastRunLine.tsx client/src/components/eval-suite/helpers.ts client/src/components/eval-suite/helpers.test.ts client/src/components/eval-suite/CaseList.test.tsx "client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx" "client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/styles.ts"`
  - `cd client && pnpm exec vitest run "src/app/(shell)/agents" --reporter=dot --silent` (the SPEC-04 / SPEC-05 Evals-tab tests stay green)
  - `grep -rnE "EvalsTab/(CaseList|MetricCards|RunHistory|helpers)" client/src` (no output)
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "Re-exporting a shared helper through a page-local `helpers.ts` breaks the dev server." — Rule: when a page-local helper becomes shared, move it and update the call sites to import the shared module directly — do NOT leave a re-export shim behind … — `client/INSIGHTS.md` (2026-09-19)
  - "Moving a component folder breaks `vi.mock("../../…/lib/hooks/x")` in its test, and `from "…"` greps do not see it." — Rule: mock module paths with the alias … and, before a move, also grep `vi.mock\("\.`. — `client/INSIGHTS.md` (2026-09-21)
  - "A missing number renders as an em dash, never as `$0.00`." — Rule: route every USD value through `formatUsd` … — `client/INSIGHTS.md` (2026-09-19)
  - Spec NFR Accessibility: "The JSON badge, row states and the last-run strip carry text and icon, never colour alone."

#### T022 [P] — Engine diff parser skips `\ No newline at end of file` lines (touches the review path for every run)
- Area: backend
- Agent: implementer
- Depends on: —
- Files (exclusive):
  - `server/src/adapters/git/diff-parser.ts` (modified)
  - `server/test/diff-parser.test.ts` (new)
- Skills: onion-architecture → §3, §5 Infrastructure, §8, §11; typescript-expert → Code Review Checklist; TESTING.md
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - The parser stays pure — no I/O, no new import — and its signature `parseUnifiedDiff(raw: string): UnifiedDiff` does not change; it is domain code that lives under `adapters/` (known debt), so it is not moved in this task — onion-architecture §3 (pure parsers are not adapters)
  - Inside a hunk, a line starting with `\` is skipped before the `+` / `-` / context branches: it adds no entry to `newLineNumbers`, does not advance the new-side cursor, and counts as neither an addition nor a deletion (A15) — onion-architecture §5 Infrastructure (the parser's output must describe the real diff)
  - Every other branch (`diff --git`, `+++ `, `--- `, hunk headers, `+`, `-`, context, the empty-string line counted as context, lines before any hunk) behaves exactly as before; no other leniency is "fixed" here — onion-architecture §11 (one small move, `arch:check` green)
  - The `UnifiedDiff` / `DiffHunk` contracts in `vendor/shared` are not touched — onion-architecture §2 (contracts are the core)
  - The new test is a pure unit test in `server/test/diff-parser.test.ts` (no container, DB or network); `server/test/grounding.test.ts` is not edited and stays green — onion-architecture §8 (domain tested without a container)
  - One happy path (a hunk ending with the marker after a changed last line) and the edge that matters (the marker between a `-` line and a `+` line), no exhaustive matrix — TESTING.md §Philosophy (typological, not exhaustive)
  - No `any`, no non-null assertion added — typescript-expert §Code Review Checklist (Type Safety)
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `parseUnifiedDiff(raw: string): UnifiedDiff` — exported here (unchanged signature; used by `reviews/diff-loader.ts`, `adapters/git/simple-git.ts`, `adapters/mocks.ts` and, through `parseDiff`, by every eval run, T008)
- Steps:
  1. Test first (`server/test/diff-parser.test.ts`): (a) `@@ -1,2 +1,2 @@` / ` a` / `-b` / `\ No newline at end of file` / `+c` / `\ No newline at end of file` → the hunk's `newLineNumbers` are `[1, 2]` (today `[1, 2, 3, 4]`, with `+c` at 3), additions 1, deletions 1; (b) `@@ -5,2 +5,3 @@` / ` x` / ` y` / `+z` / `\ No newline at end of file` → `newLineNumbers` `[5, 6, 7]` with no phantom 8; (c) the same input through `groundFindings` (from `src/platform/grounding.ts`, as `grounding.test.ts` does) keeps a finding on line 2 of (a) and drops one on line 4. Run red.
  2. Add the `\` skip to `parseUnifiedDiff`.
  3. Run the review-path suites that use the parser: `grounding.test.ts` and `reviews.it.test.ts`.
- Acceptance criteria:
  - SPEC-06 AC5 and AC14 agree with the engine: a new-side line number the strict editor parser (A2, `\` uncounted) assigns is the number the engine grounds and scores against, so a single-case run (and every later run) grades a manual case on the lines the editor validated.
  - Review path: a finding on a line after a `\ No newline at end of file` marker grounds on its real number, and no line after the hunk's last line is treated as covered; `server/specs/review-flow.md` invariant 1 still holds (grounding stays mandatory, only its line numbers are corrected).
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh server server/src/adapters/git/diff-parser.ts server/test/diff-parser.test.ts`
  - `cd server && pnpm exec vitest run test/grounding.test.ts --reporter=dot --silent`
  - `cd server && TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run test/reviews.it.test.ts --reporter=dot --silent` (the review path for every run stays green)
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - `server/specs/review-flow.md` invariant 1: "Grounding is mandatory and the score follows it. Findings that do not cite a line present in the diff are dropped before persistence, and the score is recomputed from the survivors." This task changes which lines count as present (the phantom line after the marker no longer does), on every review run, not only on eval runs.
  - `server/CLAUDE.md` › Read when: "Read `specs/review-flow.md` before changing anything on the review path — it states the invariants (grounding, null-vs-zero cost, …)."
  - "`typecheck` in `server/` … never type-checks `test/`" — Rule: type-check tests separately with a scratch tsconfig (`"rootDir": ".."` for server). — `INSIGHTS.md` (2026-09-26, 2026-10-03)
  - "`pnpm exec vitest run .it.test` is flaky in a sandboxed shell" — Rule: set `TESTCONTAINERS_RYUK_DISABLED=true` … and just retry on `CONNECT_TIMEOUT`. — `server/INSIGHTS.md` (2026-09-22)

### Wave 2 — parallel

#### T012 [P] — `EvalCaseService`: list per owner, get, create, edit with revisions, single-case run, boot reaping
- Area: backend
- Agent: implementer
- Depends on: T002, T003, T006, T007, T008
- Files (exclusive):
  - `server/src/modules/evals/case-service.ts` (new)
  - `server/test/eval-case-service.test.ts` (new)
- Skills: onion-architecture → §5 Application, §6, §7, §8, §11; security → A01, A05, A09; typescript-expert → Code Review Checklist (Error Handling Patterns)
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - `EvalCaseService` takes `EvalCaseDeps` only; it imports no `Container`, drizzle, `db/*`, `adapters/**` or another module, and never `new`s a repository (this file name is not under `arch:check`'s APPLICATION pattern, so the Verify grep guards it) — onion-architecture §5 Application
  - Owner and case checks come first: unknown owner or a case not in that owner and workspace → `NotFoundError` before any validation, write or model call (SPEC-06 AC24) — security §A01
  - `createCase`: `validateCaseDraft(draft, caseNames(owner).names)`; any issue → `new AppError('eval_case_invalid', 'Eval case is invalid', 422, { issues })`; else `insertManualCase` with `inputFiles` = the parsed paths, `inputMeta` = `{ pr_title, pr_description }`, `expectedOutput` from the check; a `null` answer (name taken meanwhile, A1) → the same 422 with `issues: [{ field: 'name', code: 'name_taken', line: null, key: null }]`; else answer 201-ready `SaveEvalCaseResponse` (`revision_created: true`) built from `getCase` — security §A05 (server re-validates whatever the client sent)
  - `updateCase` on a finding-made case (`provenance` set): only the name may change — a content difference (`revisionContentChanged`) → 422 `eval_case_content_fixed`; only the name rules apply. On a manual case: full validation with `otherNames` = the names of the set's OTHER cases (the case's own row excluded); `revisionContentChanged` false → `content: null` (no revision, SPEC-06 AC11); `'conflict'` → 409 `eval_case_edit_conflict`; `'name_taken'` → 422 `eval_case_invalid` with the `name_taken` issue (A1) — onion-architecture §5 Application, §7
  - `getCase` builds `EvalCaseDetail`: `expected_output` = stored, or `expectedOutputFromProvenance` for finding-made revisions (A4); `last_run` = `pickLastRun(check, runResult)`; `origin` from `provenance` — onion-architecture §5 Application
  - `startCheck`: `caseForRun` (404) → `resolveRunConfig` (404 / 422) → `startCheck` with `expected = expectedCount(type)` (`null` → 409 `eval_case_check_in_progress`) → return `{ check_id }`, then `void` the background `runCaseReview` → `finishCheck(got = findingsMatching)`, with a `.catch` that logs ids and closes the check as `errored`; the answer never waits for the review (spec NFR Latency) — onion-architecture §5 Application
  - A single-case run writes only `eval_case_checks`: never `createRun`, `insertCaseResult` or anything SPEC-05 reads (SPEC-06 AC15) — onion-architecture §5 Application
  - `reapStaleChecks` = `failRunningChecks('interrupted by a server restart', now())` (A11) — onion-architecture §5 Application
  - No external call inside a repository transaction; logs carry ids, codes and counts only — never diff, expected output, name or notes — onion-architecture §6; security §A09
  - Errors are `AppError` subclasses discriminated by class / `code`, never by message — typescript-expert §Code Review Checklist (Error Handling Patterns)
  - Unit tests use in-memory fakes of the repository and ports and a scripted `CaseRunnerDeps`, awaiting the background check through the fake's `finishCheck` promise — onion-architecture §8
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `interface EvalCaseDeps { cases: Pick<EvalCaseRepository, 'ownerName' | 'caseNames' | 'listCases' | 'getCase' | 'insertManualCase' | 'updateCase' | 'caseForRun' | 'startCheck' | 'finishCheck' | 'failRunningChecks'>; config: RunConfigPorts; runner: CaseRunnerDeps; now?: () => Date }` — exported here
  - `class EvalCaseService { constructor(deps: EvalCaseDeps) }` — exported here
  - `listCases(workspaceId: string, owner: EvalCaseOwner): Promise<EvalCaseListItem[]>` — exported here
  - `getCase(workspaceId: string, owner: EvalCaseOwner, caseId: string): Promise<EvalCaseDetail>` — exported here
  - `createCase(workspaceId: string, owner: EvalCaseOwner, draft: EvalCaseDraft): Promise<SaveEvalCaseResponse>` — exported here
  - `updateCase(workspaceId: string, owner: EvalCaseOwner, caseId: string, draft: EvalCaseDraft): Promise<SaveEvalCaseResponse>` — exported here
  - `startCheck(workspaceId: string, owner: EvalCaseOwner, caseId: string, logger: EvalLogger): Promise<StartEvalCaseCheckResponse>` — exported here
  - `reapStaleChecks(): Promise<number>` — exported here
  - `insertManualCase(values: NewManualCase): Promise<string | null>` and `updateCase(values: CaseUpdate): Promise<CaseUpdateOutcome>` with `CaseUpdateOutcome = 'renamed' | 'revised' | 'conflict' | 'name_taken'` (from T006, T001)
  - Uses `validateCaseDraft` (from T002); `revisionContentChanged`, `expectedOutputFromProvenance`, `pickLastRun` (from T003); `EvalCaseRepository` methods (from T006); `runCaseReview`, `resolveRunConfig`, `RunConfigPorts`, `CaseRunnerDeps` (from T008)
- Steps:
  1. Tests first (`eval-case-service.test.ts`, no DB): valid draft → inserted once, `revision_created: true`; stray-line diff → 422 with the issue and its line, nothing inserted; duplicate name on create → `name_taken` before any insert; the fake `insertManualCase` answering `null` (a concurrent save took the name) → 422 `eval_case_invalid` with the `name_taken` issue; the fake `updateCase` answering `'name_taken'` → the same 422; manual case renamed only → `updateCase` called with `content: null`, `revision_created: false`; end line changed → content passed; finding-made case with a changed diff → 422 `eval_case_content_fixed`; `getCase` with a check finished after the run result → `last_run.source = 'check'`; `startCheck` with `startCheck` returning null → 409; a scripted pass → `finishCheck` with `status: 'passed'`, `got: 1`; `llm()` throwing (EC18) → `errored` with the reason; no `createRun`-like call exists on the fakes; unknown owner → `NotFoundError` and no runner call. Run red.
  2. Implement the service.
- Acceptance criteria:
  - SPEC-06 AC3, AC5, AC8 (server refusal with the same reasons, a name clash caught by the index included), AC9 (stored exactly as entered), AC10 (finding-made: name only), AC11 (revision vs rename), AC14 (single-case run with the owner's configuration, reason when errored), AC15 (never in history), AC24 hold at the service level.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh server server/src/modules/evals/case-service.ts server/test/eval-case-service.test.ts`
  - `grep -nE "drizzle-orm|db/(schema|client)|adapters/|platform/container" server/src/modules/evals/case-service.ts` (no output)
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "A NEW module that needs another module's SERVICE … trips `arch:check`'s `no-circular` …" — Rule: don't add a container facade for another module's service … retype its parameter … to a minimal structural interface. — `server/INSIGHTS.md` (2026-09-22). The service takes `EvalCaseDeps`, never `Container`.
  - "A run's cost is `null` for 'unknown', `0` for 'free'" — Rule: the failure path writes `costUsd: null` … — `server/INSIGHTS.md` (2026-09-19)
  - Spec NFR Logging: "No diff, expected output, name or notes in logs."
  - Spec NFR Model calls: "Validation and scoring make no model request. A single-case run makes the requests one review of that case makes through the review engine, re-asks included, and nothing else."
  - Spec AC8: "IF the name … equals another case's name in the owner's set, THEN the system shall refuse to save and name the reason."

#### T013 [P] — `EvalService`: shared executor, skill runs, remembered agent; container deps
- Area: backend
- Agent: implementer
- Depends on: T003, T007, T008
- Files (exclusive):
  - `server/src/modules/evals/service.ts` (new by the SPEC-04 plan T009; modified here)
  - `server/src/platform/container.ts` (modified)
  - `server/test/evals-service.test.ts` (new by the SPEC-04 plan T009; modified here)
- Skills: onion-architecture → §5 Application, §5 Composition root, §7, §8; security → A01, A09; typescript-expert → Code Review Checklist (Error Handling Patterns)
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - The SPEC-04 per-case loop body is replaced by one `runCaseReview(...)` call whose `CaseOutcome` becomes the `CaseResultInsert` (with `caseRevisionId`); every SPEC-04 behaviour and test stays the same (the case-name retry of `createCaseFromFinding` included) — onion-architecture §5 Application
  - `EvalDeps` gains `skills: Pick<SkillEvalRepository, 'skillForRun' | 'evalAgent' | 'setEvalAgent' | 'agentName' | 'casesForSkill' | 'createSkillRun' | 'listSkillRuns'>`; the service still takes no `Container` — onion-architecture §5 Application
  - `startSkillRun` order: `resolveRunConfig(ports, ws, { kind: 'skill', id })` (404 / 422 agent required / missing) → `casesForSkill` (0 → 422 `no_eval_cases`) → `createSkillRun({ skillVersion: skill.version, viaAgentId, agentName, agentVersion: config.agent_version, config, cases })` (`null` → 409 `eval_run_in_progress`) → return `{ run_id }`, then `void` the same background execute as agent runs (SPEC-06 AC19, AC20, AC21) — onion-architecture §5 Application, §7
  - The skill run never writes `agent_skills` or the agent row; the measured skill is on only inside the run's `config` (SPEC-06 AC19) — onion-architecture §5 Application
  - `listSkillRuns` and `getSkillEvalAgent` check the skill first (404); `getSkillEvalAgent` → `{ agent: row?.agentId ? { id, name } : null, missing_agent_name: row && !row.agentId ? row.agentName : null }` — security §A01
  - `setSkillEvalAgent`: skill (404) → `agentName(ws, agentId)` (undefined → `NotFoundError`, another workspace's agent included) → `setEvalAgent` → the new `SkillEvalAgent` — security §A01
  - Logs carry ids, codes and counts only — security §A09
  - `container.evals` builds `skills: new SkillEvalRepository(this.db)` into `EvalDeps` and its `Pick` gains `'startSkillRun' | 'listSkillRuns' | 'getSkillEvalAgent' | 'setSkillEvalAgent'`; nothing else in `container.ts` changes — onion-architecture §5 Composition root
  - Unit tests extend the SPEC-04 fakes; errors are asserted by class and `code` — onion-architecture §8; typescript-expert §Code Review Checklist (Error Handling Patterns)
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `startSkillRun(workspaceId: string, skillId: string, logger: EvalLogger): Promise<StartEvalRunResponse>` — exported here
  - `listSkillRuns(workspaceId: string, skillId: string): Promise<SkillEvalRunSummary[]>` — exported here
  - `getSkillEvalAgent(workspaceId: string, skillId: string): Promise<SkillEvalAgent>` — exported here
  - `setSkillEvalAgent(workspaceId: string, skillId: string, agentId: string): Promise<SkillEvalAgent>` — exported here
  - `Container.evals: Pick<EvalService, 'createCaseFromFinding' | 'listCases' | 'deleteCase' | 'startRun' | 'listRuns' | 'getRun' | 'reapStaleRuns' | 'startSkillRun' | 'listSkillRuns' | 'getSkillEvalAgent' | 'setSkillEvalAgent'>` — exported here
  - Uses `runCaseReview`, `resolveRunConfig`, `RunConfigPorts` (from T008); `SkillEvalRepository` methods (from T007)
- Steps:
  1. Tests first (in `evals-service.test.ts`): the existing SPEC-04 cases still pass after the executor swap; `startSkillRun` with no remembered agent → 422 `eval_agent_required`, nothing created; agent deleted → 422 `eval_agent_missing` with its name; 0 skill cases → 422 `no_eval_cases`; `createSkillRun` null → 409; a run → `createSkillRun` got the skill version, via agent id and name, `agent_version`, and a config whose skills include the measured skill enabled; `setSkillEvalAgent` with an unknown agent → `NotFoundError`. Run red.
  2. Implement the service changes and the container deps.
- Acceptance criteria:
  - SPEC-06 AC18 (choice remembered until changed), AC19 (current config + current skill version, on for that run only), AC20 (skill and agent ids, names, versions recorded), AC21 (refusals with reasons, the missing agent named), AC24 hold at the service level; SPEC-04 behaviour is unchanged.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh server server/src/modules/evals/service.ts server/src/platform/container.ts server/test/evals-service.test.ts`
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "A NEW module that needs another module's SERVICE … trips `arch:check`'s `no-circular` the moment `container.ts` is taught to construct it." — Rule: don't add a container facade for another module's service … — `server/INSIGHTS.md` (2026-09-22). `EvalService` takes `EvalDeps`, so its getter adds no cycle.
  - Spec EC22: "A skill run and the picked agent's own run at the same time — both proceed; each records its own configuration."
  - Spec EC23: "A skill is edited during its run — the run keeps the skill version recorded at its start."

#### T014 [P] — Case Editor dialog: draft state, validation while typing, Save, Run case, Run on save, last-run strip
- Area: frontend
- Agent: implementer
- Depends on: T009, T010, T011
- Files (exclusive):
  - `client/src/components/case-editor/CaseEditor.tsx` (new)
  - `client/src/components/case-editor/draft.ts` (new)
  - `client/src/components/case-editor/draft.test.ts` (new)
  - `client/src/components/case-editor/useCaseDraft.ts` (new)
  - `client/src/components/case-editor/useRunOnSave.ts` (new)
  - `client/src/components/case-editor/dialogStyles.ts` (new)
  - `client/src/components/case-editor/index.ts` (new)
  - `client/src/components/case-editor/CaseEditor.test.tsx` (new)
- Skills: frontend-ui-architecture → §4, §5, §6, §8; react-best-practices → Component Design, Derive Don't Store, Hooks, Conditional Rendering, Accessibility; next-best-practices → Directives; react-testing-library → Query Priority, Async Testing, Mocking Strategies
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - `"use client"` only on `CaseEditor.tsx`; the dialog is the `@devdigest/ui` `Modal` wrapped in `<div onClick={(e) => e.stopPropagation()}>`; Escape closes; on unmount focus returns to `returnFocusTo` — next-best-practices §Directives; react-best-practices §Accessibility
  - Title: `caseEditor.newCase` for a new case, `caseEditor.caseTitle` with the saved name otherwise; owner line `ownerAgent` / `ownerSkill` with `ownerName` (SPEC-06 AC1, AC10) — react-best-practices §Conditional Rendering
  - `draft.ts` is pure: `emptyDraft()` (empty name, diff, title, description; `must_find`; empty expectation; `expected_output_json: "[]"`), `draftFromDetail(detail)` (expected output pretty-printed), `isDirty(draft, saved)`, `runCaseBlocker({ isNew, dirty, checkRunning, rateLimitedUntil, nowMs, runBlocker })` → `"unsaved" | "running" | "rateLimited" | "noAgent" | null` — frontend-ui-architecture §4 (tier 1)
  - `useCaseDraft` holds the draft in state and a 300 ms debounced copy (a timer effect with cleanup); `validateCaseDraft(debounced, otherNames)` and `parseCaseDiff` run during render from the debounced copy, never stored in state (spec NFR Latency) — react-best-practices §Hooks, §Derive, Don't Store
  - Save is disabled while any issue exists or while saving; on success with Run on save on, the returned case id is checked through `useStartEvalCaseCheck`; the dialog stays open (A6); a 422 `eval_case_invalid` shows its `details.issues` like client issues (a server-side `name_taken` included, A1); other refusal codes map to `caseEditor.errors.<code>` (else `generic`) in a `role="alert"` line while the global toast also fires — react-best-practices §Accessibility
  - Run case is disabled with the visible `caseEditor.runBlocked.<reason>` text linked by `aria-describedby` whenever `runCaseBlocker` is non-null (SPEC-06 AC16); a 429 sets `rateLimitedUntil` from `rateLimitedUntil(err, Date.now())` — react-best-practices §Accessibility
  - Accessible names the e2e flow (T025) selects by, each also set as `aria-label` with exactly this text: the name input `caseEditor.nameLabel` ("Name"); the Save button `caseEditor.save` ("Save"), kept while its visible text reads `saving` (accepted R1) — react-best-practices §Accessibility
  - `useRunOnSave` reads / writes `localStorage["dd-eval-run-on-save"]` (`"1"` / `"0"`), default off; the toggle is a labelled switch reachable by keyboard (SPEC-06 AC1) — react-best-practices §Hooks
  - A finding-made case (`origin: "finding"`) passes `readOnly` to every input piece and shows `fromFindingHint`; only the name stays editable (SPEC-06 AC10) — react-best-practices §Component Design
  - The strip is `<LastRunLine lastRun={detail.last_run} running={detail.check?.status === "running"} />` (SPEC-06 AC14, AC15); for a skill case the footer also shows `viaAgent` when `viaAgentName` is set — react-best-practices §Conditional Rendering
  - Inline styles in `dialogStyles.ts`; strings only from `eval`; `CaseEditor.tsx` < ~200 lines (sub-parts live in the T010 pieces) — frontend-ui-architecture §5, §8
  - Tests mock `@/lib/hooks/eval-cases` by alias, render with the real `eval` bundle, use `fireEvent`, `findBy` / `waitFor` (fake timers for the debounce) — react-testing-library §Mocking Strategies, §Async Testing
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `interface CaseEditorProps { owner: EvalCaseOwner; ownerName: string; caseId: string | null; otherNames: readonly string[]; runBlocker: "noAgent" | null; viaAgentName: string | null; returnFocusTo: HTMLElement | null; onClose: () => void }` — exported here
  - `CaseEditor(props: CaseEditorProps): JSX.Element` from `client/src/components/case-editor` (`index.ts`) — exported here
  - The accessible names "Name" (name input) and "Save" (Save button) — exported here (used by T025)
  - `useEvalCase`, `useCreateEvalCaseDraft`, `useUpdateEvalCase`, `useStartEvalCaseCheck` with the signatures pinned in T009 (from T009)
  - `DiffInput`, `ExpectationFields`, `ExpectedOutputEditor`, `issueMessageKey`, `issueValues`, `firstIssue` with the signatures pinned in T010 (from T010)
  - `LastRunLine(props: { lastRun: EvalCaseLastRun | null; running: boolean }): JSX.Element` and `rateLimitedUntil(err: unknown, nowMs: number): number | null` (from T011)
- Steps:
  1. Tests first: `draft.test.ts` — `runCaseBlocker` order (new → `unsaved`; dirty → `unsaved`; running → `running`; rate-limited → `rateLimited`; `noAgent`); `isDirty` false after `draftFromDetail`. `CaseEditor.test.tsx` — a new case opens titled "New eval case" with the owner line, Run on save off, Run case disabled with "Save first"; typing a stray-line diff shows its line reason after the debounce and keeps Save disabled; a valid form saves once with the draft (create mock) and the title becomes "Eval case · <name>"; the name input is found by `getByLabelText("Name")` and the Save button by `getByRole("button", { name: "Save" })`; a save rejected with 422 `eval_case_invalid` and a `name_taken` issue shows "Another case in this set already has this name" under the name; with Run on save on, the check mutation is called with the new id; a detail with a running check disables Run case with "Already running"; a 429 from the check shows "Too many runs — try again in a minute"; a finding-made detail disables the diff and shows the hint; Escape calls `onClose`. Run red.
  2. Implement `draft.ts`, the hooks, the dialog and styles.
- Acceptance criteria:
  - SPEC-06 AC1 (fields, toggle default off and remembered, Cancel / Run case / Save), AC8 (name issues on the dialog, from the client check or the server), AC10, AC14 (strip without reload), AC15 (strip shows the newer result), AC16 (the three disabled reasons) are visible in the dialog.
  - The name input and the Save button carry the accessible names pinned above, asserted by `CaseEditor.test.tsx` (accepted R1).
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh client client/src/components/case-editor/CaseEditor.tsx client/src/components/case-editor/draft.ts client/src/components/case-editor/draft.test.ts client/src/components/case-editor/useCaseDraft.ts client/src/components/case-editor/useRunOnSave.ts client/src/components/case-editor/index.ts client/src/components/case-editor/CaseEditor.test.tsx`
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "`@devdigest/ui` `Modal` is not portaled: clicks inside it bubble to the parent that renders it." — Rule: … any other `Modal` placed under a clickable ancestor must stop click propagation itself. — `client/INSIGHTS.md` (2026-09-21)
  - "`@testing-library/user-event` is NOT installed; component tests use `fireEvent`." — Rule: use `fireEvent` … — `client/INSIGHTS.md` (2026-09-26)
  - Spec NFR Latency: "The diff preview and the JSON badge update within 300 ms after the user stops typing, for a 100,000-character diff on the local stack."
  - Spec NFR Accessibility: "every editor control is reachable by keyboard and the dialog returns focus to the row that opened it."

#### T015 [P] — Skill run action: remembered agent, agent picker, "via <agent>", Change agent
- Area: frontend
- Agent: implementer
- Depends on: T009, T011
- Files (exclusive):
  - `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/useSkillEvalRun.ts` (new)
  - `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/AgentPickerDialog.tsx` (new)
  - `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/RunSkillEvalsAction.tsx` (new)
  - `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/helpers.ts` (new)
  - `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/helpers.test.ts` (new)
  - `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/RunSkillEvalsAction.test.tsx` (new)
- Skills: frontend-ui-architecture → §4, §5, §6, §8; react-best-practices → Component Design, Derive Don't Store, Hooks, Accessibility, Conditional Rendering; react-testing-library → Query Priority, Async Testing, Mocking Strategies
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - `helpers.ts` is pure: `skillRunBlocker(cases, runs)` → `"noCases" | "inProgress" | null` (via `runAllBlocker` from `@/components/eval-suite`), `needsAgent(agent)` → true when `agent.agent` is null — frontend-ui-architecture §4 (tier 1)
  - `useSkillEvalRun` orchestrates `useSkillEvalAgent`, `useSetSkillEvalAgent`, `useStartSkillEvalRun`, `useSkillEvalCases`, `useSkillEvalRuns`; picker open state is the only `useState`; blocker, pending and error code are derived (SPEC-06 AC21) — react-best-practices §Hooks, §Derive, Don't Store
  - `run()` with no remembered agent opens the picker, and after a confirmed pick starts the run; with one it starts at once; `changeAgent()` opens the picker without starting (SPEC-06 AC18) — react-best-practices §Component Design
  - The picker is a `Modal` inside a `stopPropagation` wrapper with a labelled `SelectInput` over `useAgents()`; it shows `picker.missing` with the remembered name when `missing_agent_name` is set (SPEC-06 AC21), `picker.noAgents` when the workspace has none; Escape and Cancel close it — react-best-practices §Accessibility
  - `RunSkillEvalsAction` renders the button (`skillEvals.runAll` or `skills.detail.runOnEvals` by `label`), `skillEvals.via` with the agent name and a "Change agent" button while an agent is remembered, the blocker reason as visible text (`skillEvals.blocked.*`), and refusal codes as `skillEvals.errors.<code>` in `role="alert"` (global toast also fires) — react-best-practices §Accessibility, §Conditional Rendering
  - A 429 disables the button until `rateLimitedUntil(...)` (A8) — react-best-practices §Derive, Don't Store
  - Strings from `eval` (`skillEvals.*`) and `skills` (`detail.runOnEvals`); inline styles; no other UI library — frontend-ui-architecture §8
  - Tests mock `@/lib/hooks/eval-cases` and `@/lib/hooks/agents` by alias, load the real `eval` and `skills` bundles, use `fireEvent` — react-testing-library §Mocking Strategies, §Query Priority
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `interface SkillEvalRunControl { agent: { id: string; name: string } | null; missingAgentName: string | null; blocker: "noCases" | "inProgress" | null; pending: boolean; errorCode: string | null; rateLimited: boolean; run: () => void; changeAgent: () => void; picker: JSX.Element | null }` — exported here
  - `useSkillEvalRun(skillId: string): SkillEvalRunControl` — exported here
  - `RunSkillEvalsAction(props: { skillId: string; label: "runAll" | "runOnEvals" }): JSX.Element` — exported here
  - `useSkillEvalAgent`, `useSetSkillEvalAgent`, `useStartSkillEvalRun`, `useSkillEvalCases`, `useSkillEvalRuns` with the signatures pinned in T009 (from T009)
  - `runAllBlocker(cases: readonly unknown[], runs: readonly { status: EvalRunStatus }[]): "noCases" | "inProgress" | null`, `rateLimitedUntil(err: unknown, nowMs: number): number | null` (from T011)
- Steps:
  1. Tests first: `helpers.test.ts` — no cases → `noCases`, a running run → `inProgress`. `RunSkillEvalsAction.test.tsx` — no remembered agent: clicking Run all evals opens the picker, choosing "Security Reviewer" calls set-agent then start; remembered agent: "via Security Reviewer" and "Change agent" show, Run all evals starts at once; `missing_agent_name: "Perf Reviewer"` → the picker shows "Perf Reviewer no longer exists"; a running run disables the button with "eval run already in progress". Run red.
  2. Implement helpers, hook, picker and action.
- Acceptance criteria:
  - SPEC-06 AC18 (ask once, remember, "via <agent name>", Change agent) and AC21 (no cases, in progress, deleted agent named) are visible on the action.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh client "client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/useSkillEvalRun.ts" "client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/AgentPickerDialog.tsx" "client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/RunSkillEvalsAction.tsx" "client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/helpers.ts" "client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/helpers.test.ts" "client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/RunSkillEvalsAction.test.tsx"`
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "`@devdigest/ui` `Modal` is not portaled: clicks inside it bubble to the parent that renders it." — Rule: … any other `Modal` placed under a clickable ancestor must stop click propagation itself. — `client/INSIGHTS.md` (2026-09-21)
  - "`messages/*.json` sits outside `src/`, so `@/` cannot import it; use `@messages/…`." — Rule: import message bundles as `@messages/en/<ns>.json` … — `client/INSIGHTS.md` (2026-09-21)
  - Spec EC21: "The remembered agent was deleted — Run all evals asks for an agent again, naming the deleted one."

#### T024 [P] — One home for the eval metric helpers: `client/src/lib/eval-metrics.ts` (accepted R5)
- Area: frontend
- Agent: implementer
- Depends on: T011
- Files (exclusive):
  - `client/src/lib/eval-metrics.ts` (modified)
  - `client/src/lib/eval-metrics.test.ts` (modified)
  - `client/src/components/eval-suite/helpers.ts` (new by T011; modified here)
  - `client/src/components/eval-suite/helpers.test.ts` (new by T011; modified here)
  - `client/src/components/eval-suite/MetricCards.tsx` (new by T011; modified here)
  - `client/src/components/eval-suite/index.ts` (new by T011; modified here only if it re-exports a removed name)
- Skills: frontend-ui-architecture → §1, §3 (`lib` vs `utils` vs `helpers`), §4, §6; react-testing-library → Anti-Patterns; TESTING.md
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - `toPercent`, `formatPercent`, `deltaPoints` and `formatDelta` are deleted from `client/src/components/eval-suite/helpers.ts`; the one home of the whole-percent rule is the tier-1 `client/src/lib/eval-metrics.ts`, which already exports `toPercent`, `formatPercent`, `deltaPoints`, `signedNumber` with the same behaviour — frontend-ui-architecture §1 (things that change together live together), §3 (`lib` vs `utils` vs `helpers`)
  - No re-export shim: neither `eval-suite/helpers.ts` nor `eval-suite/index.ts` re-exports a metric helper; every consumer imports `@/lib/eval-metrics` directly through the alias — frontend-ui-architecture §6 (when promoting code, update every import site)
  - `MetricCards.tsx` imports `deltaPoints`, `signedNumber` from `@/lib/eval-metrics` and renders `deltaText` with `signedNumber(delta)` in place of `formatDelta(delta)` (A17: a negative delta reads "−2", U+2212, like the dashboards; "+4" and "0" unchanged); nothing else in the component changes — frontend-ui-architecture §4 (tier 1 pure helpers feed the view)
  - Before deleting, `grep -rnE "\b(toPercent|formatPercent|deltaPoints|formatDelta)\b" client/src` and re-point every hit that imports from `eval-suite`; `SkillsView/helpers.ts` `formatPercent` (pull / accept rates) and the SPEC-05 dashboard imports of `@/lib/eval-metrics` are left as they are — frontend-ui-architecture §6
  - `eval-metrics.ts` keeps every export and its behaviour; only its header comment changes to name the Evals tabs as consumers next to the dashboards — frontend-ui-architecture §3
  - The metric assertions that lived in `eval-suite/helpers.test.ts` (`deltaPoints` null on either side, `formatPercent` em dash and rounding) move into `client/src/lib/eval-metrics.test.ts` (adding the `deltaPoints(null, 0.5)` case it lacks); `eval-suite/helpers.test.ts` keeps only its non-metric cases — TESTING.md §Philosophy (one test per rule, where the rule lives)
  - Assertions use the literal expected strings ("83%", "—", "−2"), never a call to the function under test — react-testing-library §Anti-Patterns
  - The moved helpers stay pure and React-free; no `any` — frontend-ui-architecture §4 (tier 1)
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `toPercent(v: number | null | undefined): number | null` · `formatPercent(v: number | null | undefined): string` · `deltaPoints(latest: number | null | undefined, previous: number | null | undefined): number | null` · `signedNumber(n: number): string` — from `@/lib/eval-metrics` (existing, unchanged)
  - `MetricCards(props: { latest: EvalSuiteRunLike | null; previous: EvalSuiteRunLike | null }): JSX.Element` (from T011; props unchanged here)
- Steps:
  1. Test first: move the metric assertions into `eval-metrics.test.ts` (plus `deltaPoints(null, 0.5)` → `null` and `signedNumber(-2)` → "−2"); the Verify greps fail before the change (red).
  2. Delete the four functions from `eval-suite/helpers.ts`, re-point `MetricCards.tsx` (and any other hit of the grep), update the `eval-metrics.ts` header comment, drop the moved cases from `eval-suite/helpers.test.ts`.
- Acceptance criteria:
  - `client/src/lib/eval-metrics.ts` is the only file in `client/src` that defines `toPercent`, `formatPercent` or `deltaPoints` for eval metrics; `formatDelta` no longer exists; no shim re-exports them.
  - The agent Evals tab still shows "82%" and "+4" for the SPEC-04 fixture (its existing test stays green); a negative delta reads "−2" (A17).
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh client client/src/lib/eval-metrics.ts client/src/lib/eval-metrics.test.ts client/src/components/eval-suite/helpers.ts client/src/components/eval-suite/helpers.test.ts client/src/components/eval-suite/MetricCards.tsx client/src/components/eval-suite/index.ts`
  - `grep -nE "function (toPercent|formatPercent|deltaPoints|formatDelta)" client/src/components/eval-suite/helpers.ts` (no output) · `grep -rn "formatDelta" client/src` (no output)
  - `cd client && pnpm exec vitest run "src/app/(shell)/agents" "src/app/(shell)/evals" src/components/eval-suite src/lib/eval-metrics.test.ts --reporter=dot --silent`
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "Re-exporting a shared helper through a page-local `helpers.ts` breaks the dev server." — Rule: when a page-local helper becomes shared, move it and update the call sites to import the shared module directly — do NOT leave a re-export shim behind … — `client/INSIGHTS.md` (2026-09-19)
  - "A missing number renders as an em dash, never as `$0.00`." — Rule: route every USD value through `formatUsd` … — `client/INSIGHTS.md` (2026-09-19). `formatPercent` keeps its `NO_DATA` em dash.
  - "A green client vitest run is mostly noise with the default reporter." — Rule: … `pnpm exec vitest run <files> --reporter=dot --silent` … — `client/INSIGHTS.md` (2026-10-03)
  - The SPEC-05 plan R3 (open until this task): "Move the SPEC-04 Evals tab's `toPercent` / `formatPercent` / `deltaPoints` to `client/src/lib/eval-metrics.ts` … once both plans have shipped — why: a second consumer exists, and two copies of the points rule can drift" — `docs/plans/2026-10-12-eval-dashboard.md`

### Wave 3 — parallel

#### T016 [P] — Evals routes for cases, checks and skill runs, `container.evalCases`, boot reaping + cases integration test
- Area: backend
- Agent: implementer
- Depends on: T012, T013, T022
- Files (exclusive):
  - `server/src/modules/evals/routes.ts` (new by the SPEC-04 plan T012, edited by the SPEC-05 plan T020; modified here)
  - `server/src/platform/container.ts` (modified)
  - `server/src/app.ts` (modified)
  - `server/src/modules/evals/service.ts` (new by the SPEC-04 plan T009; modified here)
  - `server/src/modules/evals/repository.ts` (new by the SPEC-04 plan T006; modified here)
  - `server/test/eval-cases.it.test.ts` (new)
- Skills: fastify-best-practices → rules/routes.md (Route Parameters, Request Body, Reply Methods, Route-Level Configuration), rules/schemas.md (Request Validation Parts), rules/error-handling.md, rules/hooks.md (preHandler Hook), rules/logging.md (Request-Scoped Logging, Child Loggers); onion-architecture → §5 Presentation, §5 Composition root, §8; security → A01, A06; TESTING.md
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - Each handler: zod `params` / `body` / `response` → `getContext(container, req)` → ONE service call → return; no `container.db`, no drizzle, no branching, no `Schema.parse(req.body)` — onion-architecture §5 Presentation; fastify-best-practices §Request Validation Parts
  - Agent and skill variants share one handler factory per action, parameterised by the owner kind; params `z.object({ id: z.string().uuid(), caseId: z.string().uuid() })`; body `EvalCaseDraft` / `SetSkillEvalAgentBody` — fastify-best-practices §Route Parameters, §Request Body
  - Status codes: create → `reply.status(201)`; check start and skill run start → `reply.status(202)`; everything else 200; refusals leave only as `AppError` from the service or the guard — fastify-best-practices §Reply Methods, rules/error-handling.md
  - `POST …/eval-cases/:caseId/check` and `POST /skills/:id/eval-runs` carry `preHandler: runStartGuard(container)` and no `rateLimit` config (the SPEC-05 shared counter, SPEC-06 NFR Concurrency and rate) — fastify-best-practices §preHandler Hook; security §A06
  - `GET /agents/:id/eval-cases` switches to `container.evalCases.listCases(ws, { kind: 'agent', id })`; the now-unused `listCases` is deleted from `EvalService`, `EvalRepository` and the `Container.evals` Pick (no dead code); `GET /eval-runs/:id` and `getRun` are left for T023 — onion-architecture §5 Presentation
  - `container.evalCases` is a memoised getter: `new EvalCaseService({ cases: new EvalCaseRepository(this.db), config: { agentConfigSource: (w, a) => evalRepo.agentConfigSource(w, a), skillForRun: (w, s) => skillRepo.skillForRun(w, s), evalAgent: (w, s) => skillRepo.evalAgent(w, s) }, runner: { llm: (p) => this.llm(p), parseDiff: parseUnifiedDiff, tokenizer: this.tokenizer, promptLogMode: this.config.promptLog } })` — the diff parser import stays only in the container — onion-architecture §5 Composition root
  - `app.ts` calls `await container.evalCases.reapStaleChecks()` after SPEC-04's eval reaper in its own try/catch that logs a count or a warning and never fails boot — onion-architecture §5 Composition root
  - The background logger passed to `startCheck` / `startSkillRun` is `app.log`, never `req.log` (the background work outlives the request; `server/src/modules/evals/routes.ts` already passes `app.log` to `startRun`) — fastify-best-practices §Child Loggers (service-level logger from `app.log`), §Request-Scoped Logging
  - The it-test overrides every LLM provider (scripted `openai` that counts calls and can block; `anthropic` / `openrouter` throwing), `git`, `github`, `repoIntel`, `repoDocs`; the shared-limit scenario builds its own app with `runStartLimiter: new RunStartLimiter({ max: 1 })`; directly inserted `eval_cases` rows of one owner get distinct names — onion-architecture §8; TESTING.md (hermetic)
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `Container.evalCases: Pick<EvalCaseService, 'listCases' | 'getCase' | 'createCase' | 'updateCase' | 'startCheck' | 'reapStaleChecks'>` — exported here
  - HTTP API of Design › Contracts (the table, except `GET /eval-runs/:id`, which is T023's) — exported here
  - `EvalCaseService` and `EvalCaseDeps` (from T012); the four skill methods on `container.evals` (from T013); `runStartGuard(container: Container): preHandlerAsyncHookHandler` and `RunStartLimiter` (from the SPEC-05 plan T020); `parseUnifiedDiff(raw: string): UnifiedDiff` with `\` lines skipped (from T022)
- Steps:
  1. Test first (`eval-cases.it.test.ts`, testcontainers): an agent; `POST /agents/:id/eval-cases` with a valid draft → 201, revision 1, listed with `latest_result: null` (SPEC-06 AC9); a stray-line diff → 422 `eval_case_invalid` with `diff_stray_line` and its line; a 301-char title → `too_long` (AC4); a duplicate name → `name_taken`; a manual case renamed to the name of a finding-made case of the same agent (seeded through SPEC-04's flow) → 422 `name_taken`, and the same name on a skill's case → 201 (the set is per owner, EC11); rename only → `revision_created: false`, one revision row; end line changed → revision 2, the earlier revision still stored (AC11); a finding-made case with a changed diff → 422 `eval_case_content_fixed`; `POST …/check` → 202 before the review ends, then the detail's `last_run` reads passed with `expected: 1, got: 1`, cost or null; a manual case whose diff's last hunk ends with `\ No newline at end of file` and whose expectation names the line after the marker → the check passes when the scripted provider cites that line (T022, AC5 / AC14 numbers agree); a second check while blocked → 409 (AC16); a check while a full agent run is blocked is allowed and `GET /agents/:id/eval-runs` still lists only that run (AC15, EC17); EC14 — edit a case during a blocked full run → its result keeps the old `case_revision_id`; the recorded request contains the diff and title and neither the case name nor the expected title (AC25); a skill's case id under `/agents/:id/eval-cases/:caseId` → 404, a second workspace's owner, case or agent → 404 and 0 LLM calls (AC24); limiter `max: 1` → a second start answers 429 and creates no check. Run red.
  2. Implement routes, the container getter, the reaper call and the `listCases` removal.
- Acceptance criteria:
  - SPEC-06 AC3, AC4, AC8 (the name clash answered as a 422, never a 500), AC9, AC10, AC11, AC14, AC15, AC16, AC24, AC25 pass against real Postgres with no real model call; every run start counts against the shared limit.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh server --it server/src/modules/evals/routes.ts server/src/platform/container.ts server/src/app.ts server/src/modules/evals/service.ts server/src/modules/evals/repository.ts server/test/eval-cases.it.test.ts`
  - `grep -n "rateLimit" server/src/modules/evals/routes.ts` (no output)
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "A new enrichment step in `executeRuns` silently makes REAL network and LLM calls in `reviews.it.test.ts` …" — Rule: … extend `appWith` in the same change with an override for every client it can reach … — `server/INSIGHTS.md` (2026-09-26)
  - "A `status: 'running'` run inserted before `buildApp()` comes back as `failed`." — Rule: in a `*.it.test.ts`, insert any `running` run AFTER `buildApp()` has resolved … — `server/INSIGHTS.md` (2026-09-29). It now applies to `eval_case_checks` too.
  - "`waitForPrRuns` returns on TIMEOUT, it does not throw." — Rule: … ASSERT the statuses are terminal before asserting on anything the executor writes … — `server/INSIGHTS.md` (2026-09-19). Same for the check poll.
  - "`pnpm exec vitest run .it.test` is flaky in a sandboxed shell" — Rule: set `TESTCONTAINERS_RYUK_DISABLED=true` … — `server/INSIGHTS.md` (2026-09-22)
  - `server/specs/review-flow.md` invariant 5: "Orphans are reaped at boot, not lazily … the assumption is one API instance per database."

#### T017 [P] — Agent Evals tab: New eval case, edit and run per row, Case Editor
- Area: frontend
- Agent: implementer
- Depends on: T014
- Files (exclusive):
  - `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx` (new by the SPEC-04 plan T010; modified here)
  - `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx` (new by the SPEC-04 plan T010; modified here)
- Skills: frontend-ui-architecture → §4, §6, §8; react-best-practices → Component Design, Derive Don't Store, State Management, Accessibility; react-testing-library → Query Priority, Async Testing, Mocking Strategies
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - The tab adds a "New eval case" button (`caseEditor.newCase`, also its accessible name — the e2e flow T025 clicks it by that name) in the cases header's `SectionLabel` `right` slot, and passes `onEdit` / `onRun` / `runDisabledReason` to `CaseList` — frontend-ui-architecture §6 (compose shared pieces)
  - Editor state is one `useState<{ caseId: string | null; trigger: HTMLElement | null } | null>`; everything else (other names, run blockers) is derived during render — react-best-practices §State Management, §Derive, Don't Store
  - `CaseEditor` gets `owner = { kind: "agent", id: agentId }`, `ownerName` from `useAgent(agentId)`, `otherNames` = the other cases' names, `runBlocker: null`, `viaAgentName: null`, `returnFocusTo` = the trigger (focus back to the row, NFR Accessibility) — react-best-practices §Accessibility
  - A row run calls `useStartEvalCaseCheck(owner)`; `runDisabledReason` = `runBlocked.running` while that row's check runs, `runBlocked.rateLimited` after a 429 until `rateLimitedUntil` — react-best-practices §Accessibility
  - `useAgentEvalCases` polls 2000 ms while any listed check is `running` (on top of SPEC-04's run polling) — react-best-practices §Hooks
  - Every SPEC-04 / SPEC-05 behaviour of the tab (metrics, Run all evals, progress, history, delete, "View full dashboard →") is unchanged — frontend-ui-architecture §8
  - Tests keep the existing mocks (`@/lib/hooks/evals`) and add `@/lib/hooks/eval-cases` and `@/components/case-editor` by alias — react-testing-library §Mocking Strategies
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `CaseEditor(props: CaseEditorProps): JSX.Element` from `@/components/case-editor` (from T014)
  - `CaseList(props: { cases: readonly EvalCaseListItem[]; onDelete: (item: EvalCaseListItem) => void; onEdit?: (item: EvalCaseListItem, trigger: HTMLElement) => void; onRun?: (item: EvalCaseListItem) => void; runDisabledReason?: (item: EvalCaseListItem) => string | null }): JSX.Element` (from T011)
  - `useStartEvalCaseCheck(owner: EvalCaseOwner): UseMutationResult<StartEvalCaseCheckResponse, Error, string>` (from T009)
  - The accessible name "New eval case" (button) — exported here (used by T025)
- Steps:
  1. Tests first (added to `EvalsTab.test.tsx`): "New eval case" opens the (mocked) editor with `caseId: null` and the agent owner; a row's Edit opens it with that case id; a row's Run calls the check mutation with the case id; a row with a running check shows Run disabled with "Already running"; the existing assertions still pass. Run red.
  2. Wire the tab.
- Acceptance criteria:
  - SPEC-06 AC1 (New eval case on the agent's Evals tab), AC13 (edited rows visible), AC14 (row run) and AC16 (row run disabled with the reason) work on the agent editor.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh client "client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx" "client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx"`
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "Wrapping `SectionLabel` in your own flex row next to a button misaligns it." — Rule: put header actions in `SectionLabel`'s `right` prop … — `client/INSIGHTS.md` (2026-10-04)
  - "In the agent editor and skill detail, the scroll container is the editor `body` only while the flex chain above it keeps `minHeight: 0`." — Rule: never … wrap a tab in another `overflow` box … — `client/INSIGHTS.md` (2026-10-03)
  - "Moving a component folder breaks `vi.mock("../../…/lib/hooks/x")` in its test …" — Rule: mock module paths with the alias … — `client/INSIGHTS.md` (2026-09-21)

#### T018 [P] — Skill Evals tab (after Preview) and the header "Run on evals"
- Area: frontend
- Agent: implementer
- Depends on: T014, T015
- Files (exclusive):
  - `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/EvalsTab.tsx` (new)
  - `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/EvalsTab.test.tsx` (new)
  - `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/styles.ts` (new)
  - `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/index.ts` (new)
  - `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/SkillDetail.tsx` (modified)
  - `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/constants.ts` (modified)
- Skills: frontend-ui-architecture → §4, §5, §6, §8; react-best-practices → Component Design, Derive Don't Store, Conditional Rendering, Accessibility, Key Prop Patterns; next-best-practices → Directives; react-testing-library → Query Priority, Async Testing, Mocking Strategies
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - `TABS` gains `{ key: "evals", labelKey: "detail.tabs.evals", icon: <a valid IconName> }` directly after Preview, and the "Deliberately NO Evals tab" comment is replaced; `VALID_TABS` follows; an unknown `?tab=` still falls back to `config` (SPEC-06 AC17) — frontend-ui-architecture §8; `client/specs/pages.md` URL-state rule
  - `SkillDetail` renders `<SkillEvalsTab key={skill.id} skill={skill} />` for `evals` and `<RunSkillEvalsAction skillId={skill.id} label="runOnEvals" />` in the header row (the same action as Run all evals, SPEC-06 AC17); both imported through the folder's `index.ts` — frontend-ui-architecture §6
  - `SkillEvalsTab` (container) composes `MetricCards` (latest / previous completed skill run), "x / N passing" (`skillEvals.passing` from the latest completed run's `cases_passed` / `cases_total`), `RunSkillEvalsAction label="runAll"`, "New eval case", `CaseList` and `RunHistory` with `viaLabel` = `skillEvals.historyVia` (agent shown as `skillEvals.agentDeleted` when `agent_deleted`) (SPEC-06 AC22) — frontend-ui-architecture §4, §5
  - No completed run → no metric cards and no "x / N passing"; no cases → `skillEvals.emptyCases` — react-best-practices §Conditional Rendering
  - The Case Editor gets `owner = { kind: "skill", id }`, `ownerName = skill.name`, `runBlocker: needsAgent ? "noAgent" : null` (A7), `viaAgentName` = the remembered agent's name, `returnFocusTo` = the trigger; delete goes through `useConfirm` → `useDeleteSkillEvalCase` — react-best-practices §Accessibility
  - Derived values (latest, previous, passing, blockers, other names) are computed during render; the editor target is the only state — react-best-practices §Derive, Don't Store
  - `useSkillEvalCases` polls 2000 ms while a check or a skill run is running — react-best-practices §Component Design
  - `"use client"` only on `EvalsTab.tsx`; list keys are ids; inline styles; no extra `overflow` wrapper around the tab — next-best-practices §Directives; react-best-practices §Key Prop Patterns
  - Tests mock `@/lib/hooks/eval-cases`, `@/lib/hooks/agents` and `@/components/case-editor` by alias, load the real `eval` and `skills` bundles, `fireEvent` — react-testing-library §Mocking Strategies, §Query Priority
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `SkillEvalsTab({ skill }: { skill: Skill }): JSX.Element` and `RunSkillEvalsAction` re-exported from `.../SkillDetail/_components/EvalsTab` (`index.ts`) — exported here
  - `RunSkillEvalsAction(props: { skillId: string; label: "runAll" | "runOnEvals" }): JSX.Element`, `useSkillEvalRun(skillId: string): SkillEvalRunControl` (from T015)
  - `CaseEditor(props: CaseEditorProps): JSX.Element` (from T014)
  - `CaseList`, `MetricCards`, `RunHistory`, `latestCompleted`, `previousCompleted` with the signatures pinned in T011 (from T011)
  - `useSkillEvalCases`, `useSkillEvalRuns`, `useDeleteSkillEvalCase` with the signatures pinned in T009 (from T009)
- Steps:
  1. Tests first (`EvalsTab.test.tsx`): the tab lists cases with "never run"; two completed skill runs → metric cards and "17 / 20 passing"; a history row reads "via Security Reviewer v3 · skill v5", and a deleted agent "Perf Reviewer (deleted)"; "New eval case" opens the mocked editor with the skill owner; the tab bar of `SkillDetail` shows "Evals" right after "Preview", and the header shows "Run on evals". Run red.
  2. Implement the tab, index, styles, and the `SkillDetail` / `constants` edits.
- Acceptance criteria:
  - SPEC-06 AC1 (New eval case on a skill), AC17 (Evals tab after Preview; "Run on evals" = Run all evals), AC22 (metric cards and history with agent, agent version, skill version, deleted agent) are visible on the skill detail.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh client "client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/EvalsTab.tsx" "client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/EvalsTab.test.tsx" "client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/index.ts" "client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/SkillDetail.tsx" "client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/constants.ts"`
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "In the agent editor and skill detail, the scroll container is the editor `body` only while the flex chain above it keeps `minHeight: 0`." — Rule: never remove `minHeight: 0` from that chain or wrap a tab in another `overflow` box … — `client/INSIGHTS.md` (2026-10-03)
  - "`@devdigest/ui`'s exported `IconName` has 'Edit', not 'Pencil' …" — Rule: when an icon name … fails to typecheck, check `icons.tsx` for a rename … — `client/INSIGHTS.md` (2026-09-22)
  - "`@devdigest/ui`'s `Skeleton` has no `lines` prop" — Rule: … render `Array.from({length: n})` of `<Skeleton>` yourself … — `client/INSIGHTS.md` (2026-09-22)
  - User decision (OQ4 → A): skill eval runs appear only on the skill's own Evals tab; the Eval Dashboard stays agents-only.

### Wave 4 — integration

#### T019 [P] — Skill evals integration test: runs through an agent, versions, deletions, compare by revision, dashboards exclude skill runs
- Area: backend
- Agent: implementer
- Depends on: T016
- Files (exclusive):
  - `server/test/skill-evals.it.test.ts` (new)
- Skills: onion-architecture → §8; drizzle-orm-patterns → references/queries-joins-aggregations.md (Insert); security → A01; TESTING.md
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - DB-backed, so the name ends in `.it.test.ts`; it self-skips without Docker like its siblings — onion-architecture §8
  - Skills, agents and links are created through the HTTP API (`POST /skills`, `PUT /skills/:id`, `POST /agents`, `PUT /agents/:id/skills`) so versions are real; cases through `POST /skills/:id/eval-cases` — onion-architecture §8
  - Every LLM provider is overridden (a scripted `openai` that records requests, can block, counts calls; `anthropic` / `openrouter` throwing); `git`, `github`, `repoIntel`, `repoDocs` mocked — onion-architecture §8; TESTING.md (hermetic)
  - Poll each run with a timeout until `status !== 'running'`, then ASSERT it is terminal before any other assertion — onion-architecture §8
  - Rows that must be `running` are inserted only AFTER `buildApp()`; nothing runs after the app closes (unblock and wait first); directly inserted `eval_cases` rows of one owner get distinct names (`eval_cases_owner_name_uq`) — drizzle-orm-patterns §Insert
  - Tenancy scenarios use a second workspace's skill, agent and case inserted directly, and assert 404 plus 0 LLM calls — security §A01
  - Typological: one scenario per AC, no matrices; the run detail `GET /eval-runs/:id` is T023's test, not this one; fix only test code, report a product bug back — TESTING.md §Philosophy
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - HTTP API from T016 (Design › Contracts table); SPEC-05 `GET /eval-dashboard`, `GET /agents/:id/eval-dashboard`, `GET /agents/:id/eval-runs/compare`; SPEC-04 `POST /agents/:id/eval-runs`, `GET /agents/:id/eval-runs`, `PUT /agents/:id/eval-cases/:caseId` (T016)
- Steps:
  1. Scenarios: (a) SPEC-06 AC18 / AC21 — `POST /skills/:id/eval-runs` with no remembered agent → 422 `eval_agent_required`; `PUT /skills/:id/eval-agent` → `{ agent }`; a skill with 0 cases → 422 `no_eval_cases`. (b) SPEC-06 AC19 / EC19 / EC20 — the skill disabled on the skill list and linked but switched off on agent A → the run's `config.skills` holds it enabled at its link order with its current body; `GET /agents/:id/skills` is unchanged afterwards. (c) SPEC-06 AC20 / EC23 — a blocked run records `skill_version`, agent id, name, `agent_version`; editing the skill during the run leaves the recorded version unchanged. (d) EC22 — the agent's own full run starts while the skill run is blocked; a second skill run → 409. (e) SPEC-06 AC22 — `GET /skills/:id/eval-runs` lists the run with agent name and versions; after `DELETE /agents/:id` the run is still listed with `agent_deleted: true`; `GET /skills/:id/eval-agent` → `missing_agent_name` set; a new run → 422 `eval_agent_missing`. (f) SPEC-06 AC23 / EC24 — `DELETE /skills/:id` removes its cases, revisions, checks, runs and per-case rows (count rows). (g) SPEC-06 AC12 / EC15 — agent B runs 3 cases, one is edited through `PUT /agents/:id/eval-cases/:caseId`, B runs again; `compare` of the two runs → `case_sets = { added: 1, removed: 1 }`. (h) the SPEC-05 dashboards (`GET /eval-dashboard`, `GET /agents/:id/eval-dashboard`) contain no skill run; single-case checks add no row to `eval_suite_runs` (SPEC-06 AC15). (i) SPEC-06 AC24 — a second workspace's skill, agent or case → 404 on every skill route, 0 LLM calls.
  2. Run it; fix only test code.
- Acceptance criteria:
  - SPEC-06 AC12, AC18, AC19, AC20, AC21, AC22, AC23, AC24 pass end to end with no real model call.
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh server --it server/test/skill-evals.it.test.ts`
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "Test fire-and-forget review behaviour by INSERTING runs, not by running one." — Rule: split these — creation-time facts in the run-the-review test, derived behaviour in a direct-insert `.it.test.ts`. — `server/INSIGHTS.md` (2026-09-19)
  - "A `status: 'running'` run inserted before `buildApp()` comes back as `failed`." — Rule: … insert any `running` run AFTER `buildApp()` has resolved … — `server/INSIGHTS.md` (2026-09-29)
  - "`waitForPrRuns` returns on TIMEOUT, it does not throw." — Rule: … ASSERT the statuses are terminal … — `server/INSIGHTS.md` (2026-09-19)
  - "`pnpm exec vitest run .it.test` is flaky in a sandboxed shell" — Rule: set `TESTCONTAINERS_RYUK_DISABLED=true` … and just retry on `CONNECT_TIMEOUT` … — `server/INSIGHTS.md` (2026-09-22)

#### T023 [P] — `GET /eval-runs/:id` serves skill runs too: owner-tagged detail from the SPEC-04 `getRun` mapper (accepted R4)
- Area: backend
- Agent: implementer
- Depends on: T001, T003, T007, T016
- Files (exclusive):
  - `server/src/modules/evals/repository.ts` (modified; created by the SPEC-04 plan T006)
  - `server/src/modules/evals/service.ts` (modified; created by the SPEC-04 plan T009)
  - `server/src/modules/evals/routes.ts` (modified; created by the SPEC-04 plan T012)
  - `server/test/evals-service.test.ts` (modified; created by the SPEC-04 plan T009)
  - `server/test/eval-run-detail.it.test.ts` (new)
- Skills: onion-architecture → §5 Presentation, §5 Application, §5 Infrastructure, §7, §8, §9; zod → object-discriminated-unions; security → A01; typescript-expert → Code Review Checklist; TESTING.md
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - `EvalRepository.getRun` keeps its single row lookup on `id` + `workspace_id` and drops only the `agent_id IS NOT NULL` predicate T004 added to it; every other narrowed read (`listRuns`, the dashboards, …) keeps it — security §A01; onion-architecture §5 Infrastructure
  - The row is mapped by owner: `row.skillId !== null` → `toSkillRunSummary(row)` (T007) spread with `owner_kind: 'skill'`; else `isAgentRunRow(row)` (T003) → the existing private `toSummary(row)` spread with `owner_kind: 'agent'`; a row matching neither, or a `null` from `toSkillRunSummary`, → `undefined`; both branches add the same `config`, `cases`, `results: await this.runResults(runId)` — onion-architecture §5 Infrastructure (row → DTO mappers next to the repository)
  - No `!` non-null assertion and no `as` cast narrows the row; the type guard and the `null` answer do it — typescript-expert §Code Review Checklist (Type Safety)
  - `repository.ts` imports `toSkillRunSummary` from `./repository/skill-eval.repo.js`; that file never imports `repository.ts`, so `arch:check`'s `no-circular` stays green — onion-architecture §9
  - `EvalService.getRun(workspaceId, runId): Promise<EvalRunDetail>` stays one repository call; `undefined` → `NotFoundError('Eval run not found')`; no owner branching in the service — onion-architecture §5 Application, §7
  - The route declares `response: { 200: EvalRunDetail }` and keeps `getContext` → one service call → return; no other route changes — onion-architecture §5 Presentation
  - The body is T001's `EvalRunDetail` discriminated union; the agent branch is `AgentEvalRunDetail` plus `owner_kind: 'agent'` (additive, no field renamed or removed), so the SPEC-04 / SPEC-05 it-tests that read this route stay green unchanged — zod §object-discriminated-unions
  - In `evals-service.test.ts` only the fake repository's `getRun` return type (`EvalRunDetail | undefined`) and its fixture (`owner_kind: 'agent'`) change — onion-architecture §8
  - The it-test is a presentation test through `app.inject()` over rows inserted directly AFTER `buildApp()` (completed runs, so the reaper never touches them); every LLM provider is overridden, no run is started and 0 LLM calls are asserted; one happy path per owner plus the deleted-agent and tenancy edges — onion-architecture §8; TESTING.md §Philosophy
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `EvalRunDetail = z.discriminatedUnion('owner_kind', [AgentEvalRunDetail.extend({ owner_kind: z.literal('agent') }), SkillEvalRunDetail.extend({ owner_kind: z.literal('skill') })])`, with `type EvalRunDetail = z.infer<typeof EvalRunDetail>` (from T001)
  - `toSkillRunSummary(row: typeof t.evalSuiteRuns.$inferSelect): SkillEvalRunSummary | null` (from T007)
  - `isAgentRunRow<T extends { agentId: string | null }>(row: T): row is T & { agentId: string }` (from T003)
  - `EvalRepository.getRun(workspaceId: string, runId: string): Promise<EvalRunDetail | undefined>` and `EvalService.getRun(workspaceId: string, runId: string): Promise<EvalRunDetail>` — exported here (the `Container.evals` Pick keeps `'getRun'`, T013)
- Steps:
  1. Test first (`eval-run-detail.it.test.ts`): after `buildApp()`, insert an agent A, a skill S (through the API, so versions are real) and directly a completed agent run of A and a completed skill run of S (`agent_id` NULL, `skill_id` S, `skill_version` 5, `via_agent_id` A, `agent_name` "Security Reviewer"), each with one `eval_runs` row; `GET /eval-runs/:agentRunId` → 200 with `owner_kind: 'agent'` and today's fields; `GET /eval-runs/:skillRunId` → 200 with `owner_kind: 'skill'`, `skill_id`, `skill_version: 5`, `agent_id` = A, `agent_name`, `agent_deleted: false`, `config`, `cases` and one result; after `DELETE /agents/:A` the skill run answers `agent_id: null`, `agent_deleted: true`; a second workspace's skill run → 404; 0 LLM calls. Run red (the skill run answers 404 after T004).
  2. Widen `getRun` in the repository, retype the service method and the route response, update the service test's fake.
  3. Run the SPEC-04 it-tests that read the route.
- Acceptance criteria:
  - `GET /eval-runs/:id` of a skill run answers 200 with the skill and via-agent record of SPEC-06 AC20 and the deleted-agent flag of SPEC-06 AC22 (`owner_kind: 'skill'`, `skill_id`, `skill_version`, `agent_id`, `agent_name`, `agent_deleted`) plus `config`, `cases`, `results` (accepted R4, A9).
  - An agent run answers as before plus `owner_kind: 'agent'`; a run of another workspace, of either owner, answers 404 (SPEC-06 AC24).
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh server --it server/src/modules/evals/repository.ts server/src/modules/evals/service.ts server/src/modules/evals/routes.ts server/test/evals-service.test.ts server/test/eval-run-detail.it.test.ts`
  - `cd server && TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run test/eval-runs.it.test.ts test/eval-pipeline.it.test.ts test/evals.it.test.ts --reporter=dot --silent` (the SPEC-04 readers of the route stay green)
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "Copying `agents/helpers.ts`'s `import type {XRow} from './repository.js'` shape into a NEW module trips `arch:check`'s `no-circular` rule." — Rule: in a new module, declare the row shape `helpers.ts` needs as a local structural interface … — `server/INSIGHTS.md` (2026-09-22). Here the edge goes only `repository.ts` → `repository/skill-eval.repo.ts`.
  - "A `status: 'running'` run inserted before `buildApp()` comes back as `failed`." — Rule: in a `*.it.test.ts`, insert any `running` run AFTER `buildApp()` has resolved … — `server/INSIGHTS.md` (2026-09-29)
  - "`pnpm exec vitest run .it.test` is flaky in a sandboxed shell" — Rule: set `TESTCONTAINERS_RYUK_DISABLED=true` … and just retry on `CONNECT_TIMEOUT`. — `server/INSIGHTS.md` (2026-09-22)
  - "`typecheck` in `server/` … never type-checks `test/`" — Rule: type-check tests separately with a scratch tsconfig (`"rootDir": ".."` for server). — `INSIGHTS.md` (2026-09-26, 2026-10-03). The fake's return type in `evals-service.test.ts` is only caught that way.
  - User decision (OQ4 → A): skill eval runs appear only on the skill's own Evals tab; the Eval Dashboard stays agents-only. This route is an owner-neutral API read, not a view, and no dashboard reads it.

#### T025 [P] — e2e flow: agent editor → Evals → New eval case → paste a valid diff → Save → "never run" (accepted R1)
- Area: frontend
- Agent: implementer
- Depends on: T016, T017
- Files (exclusive):
  - `e2e/specs/10-case-editor.flow.json` (new)
  - `e2e/README.md` (modified)
  - `e2e/docs/coverage-spec.md` (modified)
- Skills: TESTING.md; `e2e/CLAUDE.md`; `e2e/docs/flow-authoring.md` (The types, Assertions are exit codes, Locator rules, Adding a flow); `e2e/docs/coverage-spec.md` (Rules a new flow must keep, Deliberately not covered)
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - One flow file `{ "name", "description", "steps": [{ "cmd": [...], "label": "…" }] }`; every `cmd` is agent-browser argv and `{BASE}` is the only placeholder — e2e/docs/flow-authoring.md §The types
  - Deterministic locators only: `--url`, `--text`, `find role|text|label`, and CSS selectors by `aria-label` (`[aria-label='Diff']`) for `fill`, `select`, `check`, `wait <sel>` and `scrollintoview`; never `chat`, never a class name or test id — e2e/docs/flow-authoring.md §Locator rules
  - Self-contained entry: `open {BASE}/agents` → `wait --url /agents` → `wait --load networkidle` → `wait --text "Security Reviewer"` BEFORE `find text "Security Reviewer" click`; then `find role button click --name "Evals" --exact` → `wait --url tab=evals` — e2e/docs/flow-authoring.md §Adding a flow
  - Every `find` step names its action (`click`, `fill`, `check`, `text`): a `find` without one clicks — e2e/docs/flow-authoring.md §Locator rules
  - A `scrollintoview` by `aria-label` precedes every click whose target may be below the fold ("New eval case", Save) — e2e/docs/flow-authoring.md §Locator rules (CI does not scroll `<main>`)
  - The case is exactly A18: `fill "[aria-label='Name']" "e2e-manual-case"`, `fill "[aria-label='Diff']" "<A18 diff joined with \n>"`, `check "[aria-label='must not flag']"`, `wait "option[value='src/e2e.ts']"` (the debounced parse is done) then `select "[aria-label='File']" "src/e2e.ts"`, `fill` "Start line" / "End line" with "2"; the expected output keeps its default `[]` — e2e/docs/flow-authoring.md §Assertions are exit codes (wait for the state, then act)
  - Save only once it is enabled: `wait "button[aria-label='Save']:not([disabled])"`, then `find role button click --name "Save" --exact`; the assertions are `wait --text "Eval case · e2e-manual-case"` (A6), then `press Escape`, `wait --text "e2e-manual-case"` and `wait --text "never run"` (SPEC-06 AC9) — e2e/docs/flow-authoring.md §Assertions are exit codes
  - Every asserted label is written as the browser renders it: check the style of the dialog title and the row state for `textTransform` before writing the `wait --text` — e2e/docs/flow-authoring.md §Assertions are exit codes
  - No model call: the flow never clicks Run case, a row Run or Run all evals, and never touches the Run on save toggle (default off) — e2e/docs/coverage-spec.md §Rules a new flow must keep
  - The one write is the accepted exception to rule 1 (A16): `coverage-spec.md` gets the coverage row for `10-case-editor`, a sentence under rule 1 naming this flow's single write (one case on the seeded agent, last in order, read by no other flow, hermetic DB only — a rerun against a dev DB fails on `name_taken`), and the "writes of any kind" row of Deliberately not covered narrowed to "except flow 10's one eval case" — e2e/docs/coverage-spec.md §Rules a new flow must keep, §Deliberately not covered
  - `e2e/README.md` gains one row in its Coverage table, in the existing format — e2e/docs/flow-authoring.md §Adding a flow
  - Typological: one journey, happy path only; refusals, edits and runs stay in the client and server suites — TESTING.md §Philosophy
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - Accessible names "Diff", "File", "Start line", "End line", "must not flag" (from T010); "Name", "Save" (from T014); "New eval case" (from T017); the row text "never run" (`evalsTab.neverRun`, from T011)
- Steps:
  1. Test first: write `e2e/specs/10-case-editor.flow.json` per the Rules and run it on the hermetic stack before the docs edit; it must fail only if a label is wrong (fix the flow's locator, never the app — a missing accessible name is reported back to T010 / T014 / T017).
  2. Run `./scripts/e2e.sh` until all ten flows pass; then add the README row and the `coverage-spec.md` row, exception sentence and narrowed "not covered" row.
- Acceptance criteria:
  - SPEC-06 AC1 (the user activates "New eval case" on an agent's Evals tab and the Case Editor opens titled "New eval case") and AC9 (a saved valid manual case is listed as "never run") pass in a real browser on the seeded stack, with no model call.
  - `./scripts/e2e.sh` reports 10/10 flows passed; the coverage docs name the flow and its single write.
- Verify (one line per touched package; add task-specific checks below it):
  - `node -e "JSON.parse(require('fs').readFileSync('e2e/specs/10-case-editor.flow.json','utf8'))"` (from the repository root; no output)
  - `grep -nE '"chat"|Run case|Run all evals|Run on save' e2e/specs/10-case-editor.flow.json` (no output)
  - `./scripts/e2e.sh` (hermetic stack; needs Docker and the agent-browser CLI; 10/10 flows pass)
  - `grep -n "10-case-editor" e2e/README.md e2e/docs/coverage-spec.md`
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - "A green `./scripts/e2e.sh` does not mean CI will pass: it runs `next dev`, CI runs a production build." — Rule: before any `find … click` on data-driven content, add a `wait --text` for that content; to reproduce CI locally, run a copy of `scripts/e2e.sh` with `next build && NEXT_DIST_DIR=.next-e2e next start -p "$WEB_PORT"` in place of `next dev`. — `e2e/INSIGHTS.md` (2026-09-30)
  - "A `find` step with no action verb CLICKS the element; it is not a presence check." — Rule: to assert an element exists without touching it, pass the `text` action … — `e2e/INSIGHTS.md` (2026-09-26)
  - "`wait --text` matches the RENDERED text, after CSS `text-transform`." — Rule: before asserting a label in a flow, check its style for `textTransform` and write the text as the browser displays it … — `e2e/INSIGHTS.md` (2026-09-26)
  - `e2e/docs/coverage-spec.md` › Rules a new flow must keep: "1. **Read-only.** No flow may mutate seeded data or trigger a model call." — this flow adds one row and mutates none (A16, user acceptance of R1 on 2026-10-13).
  - `e2e/CLAUDE.md` › Non-default conventions: "Deterministic locators only: `--url`, `--text`, `find role|text|label`. The AI `chat` command is banned".
  - Spec AC9: "WHEN the user saves a valid new case, the system shall add it to the owner's set as a manual case … and list it as \"never run\"."

### Wave 5 — docs

#### T020 — Docs: API map, data layer, client route map and cache keys
- Area: backend
- Agent: doc-writer
- Depends on: T016, T017, T018, T023, T024
- Files (exclusive):
  - `server/README.md` (modified)
  - `server/docs/architecture.md` (modified)
  - `client/README.md` (modified)
  - `client/docs/ui-architecture.md` (modified)
- Skills: —
- Steps:
  1. `server/README.md` › API map: under the `evals` node, the owner-scoped case routes, the check route, the remembered-agent and skill-run routes, and `GET /eval-runs/:id` answering either owner tagged by `owner_kind` (accepted R4); every run start shares the 10-per-minute workspace limit; no model call in validation or scoring.
  2. `server/docs/architecture.md` › Data layer: `eval_case_checks` (newest single-case result per revision, one running per case), `skill_eval_agents`, the skill columns on `eval_cases` / `eval_suite_runs`, agent views reading `agent_id IS NOT NULL` and the owner-tagged run detail as the one owner-neutral read; › Module anatomy: `evals/run-executor.ts`, `case-service.ts`, `repository/{case,skill-eval}.repo.ts` (with the shared `toSkillRunSummary` mapper); the shared case rules in `vendor/shared/contracts/eval-case.ts`; the engine diff parser skipping `\ No newline at end of file` lines (same numbering as the editor parser); › Background work: stale checks closed as errored on boot.
  3. `client/README.md` › UI route map: the skill detail `?tab=evals` and the Case Editor dialog on both Evals tabs, with the APIs they use.
  4. `client/docs/ui-architecture.md` › Cache keys: `["eval-case", kind, ownerId, caseId]` (polls while its check runs), `["skill-eval-cases", skillId]`, `["skill-eval-runs", skillId]`, `["skill-eval-agent", skillId]`, and what save, run case and skill runs invalidate; the shared folders `components/case-editor` and `components/eval-suite`, and `lib/eval-metrics.ts` as the one home of eval metric formatting (accepted R5).
- Acceptance criteria:
  - The four docs name the new routes (the widened run detail included), tables, executor, shared validation file, the parser's marker rule, client folders, the metric helpers' home and cache keys as shipped (SPEC-06 AC14, AC17, AC18 behaviour); no file under `specs/` or `<pkg>/specs/` is touched here.
- Verify (one line per touched package; add task-specific checks below it):
  - `grep -n "eval-agent" server/README.md` · `grep -n "owner_kind" server/README.md` · `grep -n "eval_case_checks" server/docs/architecture.md` · `grep -n "No newline" server/docs/architecture.md` · `grep -n "tab=evals" client/README.md` · `grep -n "skill-eval-runs" client/docs/ui-architecture.md` · `grep -n "eval-metrics" client/docs/ui-architecture.md`

### Wave 6 — specs (last)

#### T021 — Package specs: `server/specs/case-editor.md`, skills and pages specs, both spec indexes, `server/CLAUDE.md` Read-when row
- Area: backend
- Agent: doc-writer
- Depends on: T019, T020, T025
- Files (exclusive):
  - `server/specs/case-editor.md` (new)
  - `server/specs/README.md` (modified; also edited by the SPEC-04 plan T017 and the SPEC-05 plan T019 — append one entry, keep theirs)
  - `server/specs/skills.md` (modified)
  - `server/CLAUDE.md` (modified; also edited by the SPEC-04 plan T017 — add one row next to its `evals.md` row)
  - `client/specs/pages.md` (modified; also edited by the SPEC-04 plan T017 and the SPEC-05 plan T019 — add rows, keep theirs)
  - `client/specs/README.md` (modified; also edited by the SPEC-05 plan T019 — extend the `pages.md` bullet)
- Skills: —
- Steps:
  1. Write `server/specs/case-editor.md` FROM THE MERGED CODE, in the shape of `server/specs/intent.md` / `blast-radius.md`: endpoints table (the Design › Contracts routes with 201 / 202 / 404 / 409 / 422 / 429, `GET /eval-runs/:id` with its `owner_kind` union included); numbered invariants `CE1…` covering — manual cases stored exactly as entered as revision 1; the strict diff rules and every validation rule with its limit, run by the same `vendor/shared/contracts/eval-case.ts` code on the client and on every save; case names unique per set, checked by the service and guaranteed by `eval_cases_owner_name_uq`, a clash answered as `name_taken` (A1); the engine diff parser numbers new-side lines like the editor parser (`\ No newline at end of file` uncounted, T022); a content save appends revision N+1, a name-only save appends none, finding-made cases allow only a name change; every run records each case's revision and compare / alert count an edited case as one added + one removed; a single-case run is a scratch result (newest per revision, one running per case, never in history, metrics, trend, alert or dashboards, closed as errored on boot); the last-run strip rule (A3); skill-owned cases and runs through the remembered agent, the skill enabled for that run only at its link position or after the others, skill and agent versions recorded, one running run per skill independent of the agent's runs, skill runs never on the dashboards and served by the run detail only with `owner_kind: 'skill'` (A9); deletion rules (skill → everything; agent → its own cases and runs, skill runs kept with the agent's name); every start in the shared 10-per-minute workspace limit; the model receives only diff, PR title and description; workspace + owner scoping (404); no diff, expected output, name or notes in logs; data model (`eval_case_checks`, `skill_eval_agents`, the new columns). Link `specs/06-case-editor-2026-10-12.md`, and `evals.md` / `eval-dashboard.md` when they exist.
  2. `server/specs/README.md`: one bullet for `case-editor.md`.
  3. `server/specs/skills.md`: a new invariant `S11` — a skill has its own eval case set and runs (see `case-editor.md`); deleting a skill deletes them; an eval run enables the skill for that run only and never changes `agent_skills`; the Data model table gains `skill_eval_agents`.
  4. `server/CLAUDE.md` › *Read when*: "Read `server/specs/case-editor.md` before touching eval cases, single-case runs, skill eval runs or `vendor/shared/contracts/eval-case.ts`" (package-prefixed path, root INSIGHTS 2026-10-11).
  5. `client/specs/pages.md`: the skills `?tab=` row lists `evals` (after `preview`; unrecognised → `config`); the skills route row names the Evals tab hooks; a short "Case Editor" section (dialog on both Evals tabs, Run on save remembered per browser in `localStorage["dd-eval-run-on-save"]`, focus returns to the opener, the three Run-case disabled reasons, the accessible names the e2e flow `10-case-editor` selects by); presentation invariant: an unknown cost is an em dash on rows and the strip too, and eval percentages and deltas come from `lib/eval-metrics.ts` (a negative delta reads "−N").
  6. `client/specs/README.md`: the `pages.md` bullet mentions the Case Editor and the skill `?tab=evals`.
- Acceptance criteria:
  - The package specs describe SPEC-06 AC1–AC25 as shipped (user decision 2026-10-12): `server/specs/case-editor.md` exists, is indexed and linked from `server/CLAUDE.md`; `server/specs/skills.md` has S11; `client/specs/pages.md` lists `?tab=evals` for skills and the Case Editor; the earlier plans' entries in the shared files are kept; no root `specs/` file is touched.
- Verify (one line per touched package; add task-specific checks below it):
  - `grep -c "CE1" server/specs/case-editor.md` (≥ 1) · `grep -n "case-editor.md" server/specs/README.md server/CLAUDE.md` · `grep -n "S11" server/specs/skills.md` · `grep -n "evals" client/specs/pages.md` · `grep -n "Case Editor" client/specs/README.md` · `grep -n "eval_cases_owner_name_uq" server/specs/case-editor.md` · `grep -n "owner_kind" server/specs/case-editor.md`
  - `git diff --name-only -- specs/` prints nothing

## Ownership check
| File | Task |
|---|---|
| `server/src/vendor/shared/contracts/eval-ci.ts` | T001 |
| `client/src/vendor/shared/contracts/eval-ci.ts` | T001 |
| `server/src/modules/evals/editor-types.ts` | T001 |
| `server/test/contracts.test.ts` | T001 |
| `client/src/lib/hooks/evals.ts` (created by the SPEC-04 plan T007) | T001 |
| `server/src/vendor/shared/contracts/eval-case.ts` | T002 |
| `client/src/vendor/shared/contracts/eval-case.ts` | T002 |
| `server/src/vendor/shared/index.ts` | T002 |
| `client/src/vendor/shared/index.ts` | T002 |
| `server/test/eval-case-rules.test.ts` | T002 |
| `server/src/domain/evals/case-editor.ts` | T003 |
| `server/src/domain/evals/run-owner.ts` | T003 |
| `server/test/eval-case-editor.test.ts` | T003 |
| `server/src/db/schema/eval.ts` | T004 |
| `server/src/db/schema.ts` | T004 |
| `server/src/db/migrations/0019_*.sql` | T004 |
| `server/src/db/migrations/meta/_journal.json` | T004 |
| `server/src/db/migrations/meta/0019_snapshot.json` | T004 |
| `server/src/modules/evals/repository.ts` (created by the SPEC-04 plan T006) | T004 (W0), T016 (W3), T023 (W4) |
| `server/src/modules/eval-dashboard/repository/dashboard.repo.ts` (created by the SPEC-05 plan T005) | T004 |
| `server/src/modules/eval-dashboard/repository/promotion.repo.ts` (created by the SPEC-05 plan T006) | T004 |
| `client/messages/en/eval.json` | T005 |
| `client/messages/en/skills.json` | T005 |
| `server/src/modules/evals/repository/case.repo.ts` | T006 |
| `server/src/modules/evals/repository/skill-eval.repo.ts` | T007 |
| `server/src/modules/evals/run-executor.ts` | T008 |
| `server/test/eval-run-executor.test.ts` | T008 |
| `client/src/lib/hooks/eval-cases.ts` | T009 |
| `client/src/lib/hooks/eval-cases.test.tsx` | T009 |
| `client/src/lib/hooks/keys.ts` | T009 |
| `client/src/lib/hooks/index.ts` | T009 |
| `client/src/components/case-editor/DiffInput.tsx` | T010 |
| `client/src/components/case-editor/DiffPreview.tsx` | T010 |
| `client/src/components/case-editor/ExpectationFields.tsx` | T010 |
| `client/src/components/case-editor/ExpectedOutputEditor.tsx` | T010 |
| `client/src/components/case-editor/helpers.ts` | T010 |
| `client/src/components/case-editor/helpers.test.ts` | T010 |
| `client/src/components/case-editor/inputs.test.tsx` | T010 |
| `client/src/components/case-editor/styles.ts` | T010 |
| `client/src/components/eval-suite/CaseList.tsx` | T011 |
| `client/src/components/eval-suite/MetricCards.tsx` | T011 (W1), T024 (W2) |
| `client/src/components/eval-suite/RunHistory.tsx` | T011 |
| `client/src/components/eval-suite/LastRunLine.tsx` | T011 |
| `client/src/components/eval-suite/helpers.ts` | T011 (W1), T024 (W2) |
| `client/src/components/eval-suite/helpers.test.ts` | T011 (W1), T024 (W2) |
| `client/src/components/eval-suite/CaseList.test.tsx` | T011 |
| `client/src/components/eval-suite/styles.ts` | T011 |
| `client/src/components/eval-suite/index.ts` | T011 (W1), T024 (W2) |
| `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/CaseList.tsx` (deleted) | T011 |
| `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/MetricCards.tsx` (deleted) | T011 |
| `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/RunHistory.tsx` (deleted) | T011 |
| `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/helpers.ts` (deleted) | T011 |
| `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/helpers.test.ts` (deleted) | T011 |
| `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.tsx` (created by the SPEC-04 plan T010) | T011 (W1), T017 (W3) |
| `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/styles.ts` (created by the SPEC-04 plan T010) | T011 |
| `server/src/adapters/git/diff-parser.ts` | T022 |
| `server/test/diff-parser.test.ts` | T022 |
| `server/src/modules/evals/case-service.ts` | T012 |
| `server/test/eval-case-service.test.ts` | T012 |
| `server/src/modules/evals/service.ts` (created by the SPEC-04 plan T009) | T013 (W2), T016 (W3), T023 (W4) |
| `server/src/platform/container.ts` | T013 (W2), T016 (W3) |
| `server/test/evals-service.test.ts` (created by the SPEC-04 plan T009) | T013 (W2), T023 (W4) |
| `client/src/components/case-editor/CaseEditor.tsx` | T014 |
| `client/src/components/case-editor/draft.ts` | T014 |
| `client/src/components/case-editor/draft.test.ts` | T014 |
| `client/src/components/case-editor/useCaseDraft.ts` | T014 |
| `client/src/components/case-editor/useRunOnSave.ts` | T014 |
| `client/src/components/case-editor/dialogStyles.ts` | T014 |
| `client/src/components/case-editor/index.ts` | T014 |
| `client/src/components/case-editor/CaseEditor.test.tsx` | T014 |
| `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/useSkillEvalRun.ts` | T015 |
| `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/AgentPickerDialog.tsx` | T015 |
| `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/RunSkillEvalsAction.tsx` | T015 |
| `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/helpers.ts` | T015 |
| `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/helpers.test.ts` | T015 |
| `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/RunSkillEvalsAction.test.tsx` | T015 |
| `client/src/lib/eval-metrics.ts` | T024 |
| `client/src/lib/eval-metrics.test.ts` | T024 |
| `server/src/modules/evals/routes.ts` (created by the SPEC-04 plan T012) | T016 (W3), T023 (W4) |
| `server/src/app.ts` | T016 |
| `server/test/eval-cases.it.test.ts` | T016 |
| `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx` (created by the SPEC-04 plan T010) | T017 |
| `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/EvalsTab.tsx` | T018 |
| `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/EvalsTab.test.tsx` | T018 |
| `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/styles.ts` | T018 |
| `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/_components/EvalsTab/index.ts` | T018 |
| `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/SkillDetail.tsx` | T018 |
| `client/src/app/(shell)/skills/_components/SkillsView/_components/SkillDetail/constants.ts` | T018 |
| `server/test/skill-evals.it.test.ts` | T019 |
| `server/test/eval-run-detail.it.test.ts` | T023 |
| `e2e/specs/10-case-editor.flow.json` | T025 |
| `e2e/README.md` | T025 |
| `e2e/docs/coverage-spec.md` | T025 |
| `server/README.md` | T020 |
| `server/docs/architecture.md` | T020 |
| `client/README.md` | T020 |
| `client/docs/ui-architecture.md` | T020 |
| `server/specs/case-editor.md` | T021 |
| `server/specs/README.md` | T021 |
| `server/specs/skills.md` | T021 |
| `server/CLAUDE.md` | T021 |
| `client/specs/pages.md` | T021 |
| `client/specs/README.md` | T021 |

Files owned twice or three times are always in different waves (W0/W3/W4, W1/W2, W1/W3, W2/W3/W4, W2/W4, W3/W4), never in one wave. In Wave 4, T019, T023 and T025 share no file; T023 owns the three `evals` server files T016 (Wave 3) released. In Wave 2, T024 edits only the metric parts of the `eval-suite` files T011 (Wave 1) created, and T014 / T015 import from them without editing them. `server/src/adapters/git/diff-parser.ts` and `server/test/diff-parser.test.ts` are owned by T022 only, and by no task of the SPEC-04 or SPEC-05 plan (checked 2026-10-12: those plans only import the parser in `container.ts` and tests, they never edit it). `client/src/lib/eval-metrics.ts` and its test are owned by T024 only (the SPEC-05 plan that created them is done).

## Risks
- This plan builds on two plans; the names it relies on (`AgentEvalCase`, `AgentEvalCaseListItem`, `AgentEvalRunSummary`, `AgentEvalRunDetail`, `EvalRunRecord`, `EvalErrorCode`, `CaseForRun`, `AgentConfigSource`, `EvalDeps`, `EvalRepository.agentConfigSource`, `EvalRepository.getRun` / its private `toSummary` and `runResults`, SPEC-04 helpers, the `eval_cases_owner_name_uq` index, `runStartGuard`, `RunStartLimiter`, `container.evals`, `useAgentEvalCases`, the `EvalsTab` folder, the SPEC-05 repositories, `client/src/lib/eval-metrics.ts`) are the ones those plans pin, and both plans are `done` (checked 2026-10-13: `getRun`, `toSummary`, `AgentEvalRunDetail`, `eval-metrics.ts` exist as cited) → T001 Step 1 still stops and reports when one is missing or renamed.
- T004 changes `eval_suite_runs.agent_id` to nullable under code written by the SPEC-04 / SPEC-05 plans → the narrowing is limited to the TS errors that change causes plus an explicit `agent_id IS NOT NULL` on every agent-view read; T004 re-runs both earlier it-tests, and T019 asserts the dashboards contain no skill run.
- T011 moves SPEC-04 files that SPEC-05 edited and `c7fd204` restyled → the move greps every import and `vi.mock` path, keeps the agent tab's tests unchanged and green; no shim is left behind.
- Pure functions in `vendor/shared` are new and reviewer-core compiles that directory → `eval-case.ts` imports only zod and its siblings (`contracts-are-the-core`), and T002 runs the reviewer-core typecheck.
- T022 changes the parser every review run grounds against → a review whose diff contains `\ No newline at end of file` now keeps a finding on the real line after the marker and drops one on the phantom line after the hunk; stored reviews are not re-grounded (A15). The change is one skipped branch, its unit test pins both directions, and T022 re-runs `grounding.test.ts` and `reviews.it.test.ts`; it runs in Wave 1 with no dependency, so single-agent mode reaches it before T016.
- A 100,000-character diff is parsed on every debounced keystroke in the browser → the parser is linear, runs once per 300 ms pause, and the preview renders at most the parsed lines; T014's test covers the debounce, and the 300 ms budget is checked on the local stack during review.
- A name clash between the service's check and the write (two tabs saving the same name) → the SPEC-04 index rejects the second write, the case + revision transaction rolls back, and the service answers the AC8 refusal (A1); T012 covers the mapping with fakes, T016 covers the index path against Postgres through a finding-made case.
- Two plans' doc-writer tasks and T021 edit the same index files → each appends; T021 is last and is told to keep the earlier entries.
- (R4) The run detail turns into a union → between T004 and T023 a skill run answers 404 (A9, intermediate only); the agent branch only gains `owner_kind`, and T023 re-runs the three SPEC-04 it-tests that read the route; a `z.union` with the agent branch first would silently strip a skill run's fields, so T001 pins `z.discriminatedUnion` and tests a skill detail through it.
- (R4) `repository.ts` importing `repository/skill-eval.repo.ts` could form a cycle if the latter ever imports the former → T007's Verify greps that it does not; `arch:check` runs in T023's verify.
- (R5) Replacing `formatDelta` with `signedNumber` changes a negative delta on the Evals tabs from "-2" to "−2" (A17) → it matches the dashboards; no existing test asserts a negative delta (the agent tab test asserts "+4"), and T024's test pins "−2" in `eval-metrics.test.ts`.
- (R1) The e2e flow is the first that writes and the first that types into a dialog → it adds one row, runs last, is read by no flow (A16), and the exception is written into `coverage-spec.md`; a rerun against a long-lived dev DB fails on `name_taken` (documented; the hermetic runner and CI start empty). The dialog's locators are pinned as accessible names in T010 / T014 / T017 and asserted by their unit tests, so a rename fails a unit test first; CI's production build renders faster than data, so every click waits for its content first (e2e INSIGHTS 2026-09-30). `scripts/verify-task.sh` has no `e2e` package, so T025 verifies with the hermetic runner instead.

## Open questions
- none. The spec has no open question; every point settled here is listed under Assumptions (A1–A18). R2 and R3 were accepted by the user on 2026-10-12, R1, R4 and R5 on 2026-10-13; all five are planned.

# Spec: Eval Pipeline — cases from findings, runs and scoring
Spec ID: SPEC-04-eval-pipeline
Status: approved
Supersedes: none
Packages: server, client
Depends on: none

## Problem and user

The people hurt are **authors of review agents** — whoever edits an agent's
system prompt, switches its model or links a skill. Today a change like that is
a guess: there is no way to tell, in numbers, whether the agent now finds more
of what it should, flags more of what it should not, or cites lines that are not
in the diff. A prompt tweak that silently breaks the agent is found weeks later,
in a strange review on a real PR.

The data needed to catch that already exists. Every accepted finding is a
reviewer saying "this is a real problem, at this file and line"; every dismissed
finding is a reviewer saying "this was noise". Those decisions are a dataset —
no invented scenarios are needed (course brief, design `images/7.png`).

Why it matters: an eval run turns "I think the new prompt is better" into
"recall went from 78 % to 82 % and precision dropped 2 points on the same
cases". That only works if the cases are frozen (the same input every run), the
scoring is deterministic and free (no model decides whether a finding counts),
and every run records exactly which agent configuration produced it.

This spec is the core of the pipeline: cases created from findings, the agent's
case list, runs over all cases, deterministic scoring and the run history on the
agent's Evals tab. The Eval Dashboard, run comparison and Promote and the trend
chart are SPEC-05; the case editor and the skills' Evals tab are SPEC-06 (see
Non-goals).

## Goals / Non-goals

Goals:

- Create an eval case from a real finding in one click, with the expectation
  type taken from the reviewer's decision — because the decisions already made
  are the cheapest trustworthy dataset there is.
- Freeze each case's input at creation — because runs of different agent
  versions are only comparable when every run sees exactly the same input.
- Run an agent over all cases of its set and record the full configuration that
  ran — because a number is meaningless unless you know which prompt, model and
  skills produced it.
- Score recall, precision and citation accuracy with fixed rules and no model
  call — because a score must be reproducible, cost nothing and leave no room
  for a judge's opinion; the expectation is a file and a line range, so a match
  can be decided by code (course brief, `images/14.png`).
- Show the case list and the run history with metric changes on the agent's
  Evals tab — because the author must see the effect of a change where they
  make it.
- Provide one command, `pnpm verify:l06`, that proves the pipeline works end to
  end without a real model — because the homework is accepted on it.

Non-goals:

- **Eval Dashboard page, Compare runs with Promote, trend chart, alert banner,
  per-agent dashboard page, "Run all agents", case editor (manual cases, single
  case run, Run on save) and the skills' Evals tab** — they are
  `SPEC-05-eval-dashboard` (dashboard, trend, alert, Compare and Promote, "Run
  all agents") and `SPEC-06-case-editor` (case editor and the skills' Evals
  tab), because together with this one they exceed
  the ~25 acceptance criteria one spec may hold (`specs/README.md` › Lifecycle).
  This spec stores everything they need (run provenance, per-case results).
  Skill-owned cases run through an agent the user picks with the skill linked
  for that run (user answer); that behaviour belongs to SPEC-06, so no case in
  this spec is skill-owned.
- The `evals/` harness package — unchanged; this pipeline lives in the product.
- The PreToolUse test-gate hook and mutation testing (stretch tasks in
  `images/16.png`) — harness work, not product behaviour.
- An LLM judge or any model-based scoring — excluded by the course brief.
- Replaying a past agent version: a run always uses the agent's current
  configuration (making an older version current again is Promote, in SPEC-05).
- Moving or copying a case to another agent's set — a case belongs to the agent
  that produced its finding.
- Seeding demo eval cases or a demo dataset — the user's own decisions are the
  dataset; the integration test builds its own (AC27).
- How tables, contracts, routes, the run worker, the root command or the UI are
  built, and in what order — that is for the implementation planner.

## User stories

- US1: As a reviewer who has accepted or dismissed a finding, I want to turn it into an eval case with one click, so that my real decisions become a regression dataset without inventing scenarios.
- US2: As an agent author, I want to see every case of my agent's set with its latest result, so that I know what the agent is held to and where it fails.
- US3: As an agent author, I want to run my agent over all its cases on frozen inputs with its configuration recorded, so that runs of different prompts, models or skills are comparable.
- US4: As an agent author, I want recall, precision and citation accuracy computed by fixed rules without any model call, so that the numbers are reproducible, free and not a matter of opinion.
- US5: As an agent author, I want the run history and the change of each metric since the previous run on the Evals tab, so that I see whether my change made the agent better or worse.
- US6: As a developer submitting the homework, I want one command that proves the pipeline end to end without a real model, so that the acceptance criteria are checkable by anyone.

## Acceptance criteria (EARS)

- AC1 [US1]: WHEN the user activates "Turn into eval case" on an accepted finding, the system shall add to the set of the agent that produced the finding a `must_find` case expecting a finding in the finding's file whose line range overlaps the finding's start–end lines.
- AC2 [US1]: WHEN the user activates "Turn into eval case" on a dismissed finding, the system shall add to the set of the agent that produced the finding a `must_not_flag` case expecting that no finding in the finding's file overlaps the finding's start–end lines.
- AC3 [US1]: IF a finding is neither accepted nor dismissed, THEN the system shall show its "Turn into eval case" action disabled with the hint "Accept or dismiss this finding first" and create no case.
- AC4 [US1, US3]: WHEN a case is created from a finding, the system shall store with it a frozen input — the diff of the finding's file as stored for the PR at that moment, the file path, the PR title and the PR description cut to 4,000 characters — that no later PR refresh, review, decision or deletion re-reads or changes.
- AC5 [US1]: WHEN a case is created from a finding, the system shall record its provenance — the source finding, review, PR and repository, the decision and its time, the agent version that produced the finding, the expected finding's severity, category and title, and the creation time — and name the case after the finding title in lowercase kebab-case cut to 60 characters, ending in `-2`, `-3`, … within those 60 characters when that name is already taken in the agent's set, so that no two cases of one set share a name.
- AC6 [US1]: IF the agent's set already holds a case created from the same finding, THEN the system shall create no second case and show "Eval case exists" on that finding's card in place of the action.
- AC7 [US1]: IF the finding's review has no agent, its agent no longer exists, the PR has no stored diff for the finding's file, the stored diff exceeds 100,000 characters, or the finding's lines intersect no hunk of that diff while its kind is not a whole-file kind, THEN the system shall create no case and show a message naming the reason.
- AC8 [US2]: The system shall show in the agent editor an Evals tab, after Context, listing every case of the agent's set with its name, expectation type, file and line range, and its result in the latest completed run — passed, failed or errored with "expected N finding(s), got M", or "never run" when that run did not include it.
- AC9 [US2]: WHEN the user deletes a case and confirms, the system shall remove it from the set for later runs while keeping every earlier run's stored metrics and pass count unchanged.
- AC10 [US2]: WHEN an agent is deleted, the system shall delete the cases of its set and its eval runs.
- AC11 [US3]: WHEN the user presses Run all evals, which calls `POST /agents/:id/eval-runs`, the system shall start one eval run over every case in the agent's set at that moment with the agent's current configuration, and answer with the run id before any case finishes.
- AC12 [US3]: IF the agent's set has no cases or an eval run of that agent is still in progress, THEN the system shall start no run, answer with the reason ("no eval cases" or "eval run already in progress"), and show Run all evals disabled with that reason.
- AC13 [US3]: The system shall give the review engine, for each case, only that case's frozen input together with the agent's system prompt, model, strategy and the bodies of its enabled linked skills, and no repository-index context, project document, intent, memory, GitHub or git data.
- AC14 [US3, US5]: WHEN an eval run starts, the system shall record with it the agent version, provider, model, system prompt, strategy, each linked skill with its version, and the ids of the cases it covers, so that later edits to the agent, its skills or its cases do not change that record.
- AC15 [US3]: WHILE an eval run is in progress, the system shall show on the Evals tab "k / N cases" progress that updates without a page reload at least every 5 seconds.
- AC16 [US3]: IF the review of one case fails (provider error, timeout, or an invalid model answer after the engine's own re-asks), THEN the system shall record that case as errored with its reason, leave it out of all three metrics, count it as not passed, and continue with the remaining cases.
- AC17 [US3]: WHEN the last case of an eval run finishes, or the server starts and finds the run unfinished, the system shall close the run as completed if at least one case was scored and as failed otherwise, storing its duration, its pass count and its cost as the sum of the known per-case costs, or no cost when none is known.
- AC18 [US4]: The system shall decide matches, per-case pass and all three metrics without any model request, where a finding matches an expectation when its file path equals the expectation's file after trimming whitespace and a leading `./` and its start–end range overlaps the expectation's range, ends included.
- AC19 [US4]: The system shall compute recall as the number of matched `must_find` expectations divided by the number of `must_find` expectations over the run's scored cases, and report no value ("—") when that number is zero.
- AC20 [US4]: The system shall compute precision as the number of grounded findings that are not noise divided by the number of grounded findings over the run's scored cases, where noise is a grounded finding that matches a `must_not_flag` expectation of its case, and report no value ("—") when there are no grounded findings.
- AC21 [US4]: The system shall compute citation accuracy as the number of findings that passed the grounding gate divided by the number of findings the model returned over the run's scored cases, and report no value ("—") when the model returned none.
- AC22 [US4]: The system shall mark a `must_find` case passed when a grounded finding matches its expectation, and a `must_not_flag` case passed when no grounded finding matches its expectation.
- AC23 [US5]: WHILE the agent has a completed eval run, the system shall show on the Evals tab the latest completed run's recall, precision and citation accuracy as whole percentages, each with its change in points since the previous completed run, and its cases passed as "x / y".
- AC24 [US5]: The system shall show on the Evals tab the agent's eval runs ordered by start time with the newest at the top, each with its start time, agent version, recall, precision, citation accuracy, cases passed "x / y", cost (an em dash when unknown) and status.
- AC25 [US1, US2, US3]: IF an eval request names an agent, case, run or finding outside the caller's workspace, THEN the system shall answer "not found", create or change nothing and make no model request.
- AC26 [US6]: The system shall provide a single command, `pnpm verify:l06`, run from the repository root, that exits 0 only when the typecheck and tests of server, client and reviewer-core pass and the eval-pipeline integration test passes.
- AC27 [US6]: The system shall include an eval-pipeline integration test that, with a scripted model and no real model request, create at least 8 cases through the one-click flow covering both `must_find` and `must_not_flag`, run the set twice with two different system prompts, and fail unless recall or precision differs between the two runs and the scoring made no model request.

## Edge cases

- EC1: A finding is accepted, turned into a case, then dismissed — the case stays `must_find` with its original provenance; the card shows "Eval case exists" (covered by AC4, AC6).
- EC2: The user double-clicks "Turn into eval case" or clicks it in two tabs — one case is created (covered by AC6).
- EC3: The PR was force-pushed after the review, so the finding's lines are no longer in the stored diff — no case; the reason names the changed diff (covered by AC7).
- EC4: A finding of the seeded demo review, which has no agent — no case, reason shown (covered by AC7).
- EC5: A `secret_leak` finding whose lines fall outside every hunk of its file — allowed, because whole-file kinds are grounded by file alone (covered by AC7).
- EC6: The source finding, review, run or PR is deleted after the case was created — the case stays and still runs on its frozen input (covered by AC4).
- EC7: The agent is deleted — its cases and eval runs disappear with it (covered by AC10).
- EC8: Run all evals on an agent with 0 cases — refused with "no eval cases" (covered by AC12).
- EC9: Run all evals pressed twice, or in two tabs, while a run is in progress — the second start is refused (covered by AC12).
- EC10: The agent's prompt is edited while its eval run is in progress — the run keeps the configuration recorded at its start (covered by AC14).
- EC11: A skill is linked or unlinked without the agent's version changing, so two runs both say "v7" — the run records still differ in their skills (covered by AC14).
- EC12: A `must_not_flag` case where the agent returns no finding — the case passes and adds nothing to precision's count (covered by AC20, AC22).
- EC13: A `must_not_flag` case where the agent flags a different line range in the same file — not noise and the case passes (covered by AC20, AC22).
- EC14: A set with only `must_not_flag` cases — recall shows "—" (covered by AC19).
- EC15: The model returns no finding on any case — precision and citation accuracy show "—" (covered by AC20, AC21).
- EC16: No API key for the agent's provider, so every case errors — the run closes as failed with all metrics "—" (covered by AC16, AC17).
- EC17: The agent runs on an unpriced model — the run's cost shows an em dash, never "$0" (covered by AC17, AC24).
- EC18: A case is deleted after it took part in runs — those runs' metrics and "x / y" do not change (covered by AC9).
- EC19: Cases are added between two runs — the later run covers more cases, visible in its "x / y" (covered by AC14, AC24).
- EC20: The server restarts during an eval run — the run is closed on boot instead of blocking new runs forever (covered by AC17, AC12).
- EC21: A finding id, agent id or run id from another workspace — answered as not found (covered by AC25).
- EC22: The frozen diff contains "ignore previous instructions" text — it reaches the model through the same engine and injection guard as a normal review (covered by AC13).
- EC23: The model cites a line outside the case's diff — the finding is dropped by the grounding gate and lowers citation accuracy (covered by AC21).
- EC24: A case's file is 150,000 characters of diff — no case; the size limit is named (covered by AC7).
- EC25: The user opens an accepted finding inline in Files changed rather than in the findings panel — the same "Turn into eval case" action is there, because both show the same finding card (covered by AC1, AC6).

## Non-functional requirements

- **Model calls.** Scoring makes no model request (AC18). A run makes, per case, the requests one review of that case's diff makes through the review engine — re-asks on an invalid answer included — and nothing else (AC13).
- **Metric aggregation.** Recall, precision and citation accuracy are pooled counts over all scored cases of a run, not an average of per-case values (AC19–AC21); errored cases are excluded from them and count as not passed (AC16).
- **Concurrency and rate.** At most 3 cases of one run are reviewed at the same time; at most one eval run per agent is in progress (AC12); starting a run is limited to 10 requests per minute, like starting a review (`server/specs/review-flow.md` › Endpoints), because each start fans out into paid model calls.
- **Latency.** Starting a run answers before any case finishes (AC11); progress refreshes at least every 5 seconds (AC15).
- **Sizes.** Frozen diff at most 100,000 characters (AC7); PR description at most 4,000 characters, as for intent (`server/src/modules/intent/constants.ts:18`); case name at most 60 characters (AC5).
- **Tenancy.** Every eval request is scoped to the caller's workspace (AC25). Findings carry no workspace of their own, so a finding is reached only through its review's workspace (`server/INSIGHTS.md` 2026-09-19).
- **Cost.** Unknown cost is "no value", never 0; a free model is 0 (`server/specs/review-flow.md` invariant 2); the UI renders unknown as an em dash (`client/INSIGHTS.md` 2026-09-19, `formatUsd`).
- **Logging.** Each case's prompt produces the usual content-free prompt-assembly record (`server/specs/review-flow.md` invariant 6); no diff, finding text or prompt text in logs.
- **Contract reach.** The eval contracts are identical in both copies today and must stay identical after the change (root `CLAUDE.md` › Rules; `git diff --no-index` of `eval-ci.ts` shows differences only outside the eval section). Today's per-case run record has no notion of a run over many cases, no agent version, no configuration record and no expectation type; those facts are added in both copies. The client copy lacks `AgentVersion`, which SPEC-05's compare will need.
- **Testing.** Server tests make no real model call (`server/INSIGHTS.md` 2026-09-26); the integration test uses a scripted model (AC27).
- **Accessibility.** A case's passed / failed / errored / never-run state is conveyed by icon and text, never colour alone.
- **i18n.** Every label comes from the existing `eval` message namespace (`client/messages/en/eval.json`) or the PR review namespace for the finding-card action, in English, never hard-coded.
- **Public API.** A run is started with `POST /agents/:id/eval-runs` (course brief, `images/7.png`).

## Inputs and provenance

| fact | source | date |
|---|---|---|
| `eval_cases` has workspace, owner kind (`skill`/`agent`), owner id with no foreign key, name, input diff, input files, input meta, expected output, notes; no source finding, no expectation-type column | `server/src/db/schema/eval.ts:7-20` | 2026-10-11 |
| `eval_runs` is one row per case run (case FK with cascade, ran at, actual output, pass, recall, precision, citation accuracy, duration, cost); no run-over-all-cases id, no agent version, no configuration record | `server/src/db/schema/eval.ts:22-35` | 2026-10-11 |
| Eval contracts `EvalCaseInput`, `EvalRunRecord`, `EvalRunResult`, `EvalTrendPoint`, `EvalDashboard`; `EvalRun`, `EvalOwnerKind`, `EvalCase`, `EvalPerTrace` | `server/src/vendor/shared/contracts/eval-ci.ts:20-89`, `server/src/vendor/shared/contracts/knowledge.ts:49-84` | 2026-10-11 |
| The eval sections are identical in the server and client copies; the copies differ elsewhere (`AgentManifest`, `openrouter`, `AgentVersion` missing on the client) | `git diff --no-index` of `eval-ci.ts` and `knowledge.ts` | 2026-10-11 |
| No server or client code reads or writes the eval tables or contracts yet | `grep -rln -e evalCases -e evalRuns -e EvalCase server/src client/src` → schema and contracts only | 2026-10-11 |
| Plugin export carries eval cases by owner name, so a case must be self-contained without database ids | `server/src/vendor/shared/contracts/productionize.ts:46-57` | 2026-10-11 |
| `findings` has file, start and end line (both required), severity, category, title, kind, accepted and dismissed timestamps; no workspace column | `server/src/db/schema/reviews.ts:29-47` | 2026-10-11 |
| Accept and dismiss are mutually exclusive and can be switched; there is no "undecided" again | `server/src/modules/reviews/repository/review.repo.ts:119-143`, `server/src/modules/reviews/findings.ts:11-34` | 2026-10-11 |
| A review's agent is optional (`agent_id` nullable); the seeded review has none | `server/src/db/schema/reviews.ts:18`, `server/INSIGHTS.md` 2026-09-19 | 2026-10-11 |
| The PR's diff per file is stored as `pr_files.patch` (nullable) and replaced when the PR is refreshed from GitHub | `server/src/db/schema/pulls.ts:36-45`, `server/INSIGHTS.md` 2026-09-21 | 2026-10-11 |
| Grounding keeps a finding whose file is in the diff and whose range intersects a hunk, or whose kind is whole-file (`secret_leak`, `lethal_trifecta`, `phantom`, `hook`); dropped findings are reported with reasons | `reviewer-core/src/grounding.ts:16`, `reviewer-core/specs/review-contract.md` › Grounding, `reviewer-core/src/review/run.ts:135-137` | 2026-10-11 |
| A schema-invalid model answer is re-asked up to the engine's default retries | `reviewer-core/specs/review-contract.md` › Structured output | 2026-10-11 |
| An agent config change bumps the version and snapshots provider, model, prompt, strategy, gate, repo-intel and linked skill ids; linking skills does not bump the version | `server/src/modules/agents/repository.ts:133-188`, `server/src/modules/agents/repository.ts:280-293` | 2026-10-11 |
| `GET /agents/:id/versions` and `/versions/:version` exist and are workspace-scoped | `server/src/modules/agents/routes.ts:126-142` | 2026-10-11 |
| Skills carry a version and a `skill_versions` history | `server/src/db/schema/skills.ts:18-29` | 2026-10-11 |
| Reviews start fire-and-forget, 10 per minute, with runs reaped on boot | `server/specs/review-flow.md` › Endpoints, › Starting a review, invariant 5 | 2026-10-11 |
| Agent editor tabs are Config, Skills, Context; Evals is deliberately left out until its lesson | `client/src/app/(shell)/agents/[id]/_components/AgentEditor/constants.ts:10-17` | 2026-10-11 |
| The finding card is one shared component used in the findings panel and the diff viewer; its actions today are Accept and Dismiss only (no Learn, no Reply to author) | `client/src/components/finding-card/FindingCard.tsx:93-114`, `grep -rln FindingCard client/src` | 2026-10-11 |
| The `eval` message namespace exists as a placeholder | `client/messages/en/eval.json` | 2026-10-11 |
| No root `package.json` exists; each package installs on its own | `cat package.json` at the repo root → not found; root `CLAUDE.md` › Where things live | 2026-10-11 |
| Target: finding card with "Turn into eval case" after Dismiss | design `images/8.png` | 2026-10-11 |
| Target: agent Evals tab with metric cards, cases "3 / 5 passing", per-case status and "expected 1 finding, got 1" | design `images/12.png` | 2026-10-11 |
| Homework: cases in Postgres from accept/dismiss; must_find / must_not_flag; `POST /agents/:id/eval-runs` on frozen inputs; code-only scoring with recall, precision, citation accuracy; Evals tab; ≥8 cases; prompt change moves recall/precision; no LLM call in scoring; `pnpm verify:l06` green | design `images/7.png`, `images/14.png` (course brief) | 2026-10-11 |
| Stretch items Case editor, Trend chart, Compare + Promote, skills Evals tab are in scope; PreToolUse hook and mutation testing are not; agent editor gets only the Evals tab; `pnpm verify:l06` is a new root command | user answer (brief) | 2026-10-11 |
| Split: core pipeline here; dashboard, compare/promote, trend, skills Evals tab and case editor in a second spec | user answer (brief) | 2026-10-11 |
| Noise for precision is only a grounded finding overlapping a `must_not_flag` location; a `must_not_flag` case passes when nothing overlaps it | user answer (OQ1 = A) | 2026-10-11 |
| An undecided finding shows the action disabled with "Accept or dismiss this finding first" | user answer (OQ2 = A) | 2026-10-11 |
| The frozen input is the whole patch of the finding's file, capped at 100,000 characters | user answer (OQ3 = A) | 2026-10-11 |
| Accepted as written: background runs with progress, 3 cases at a time, one run per agent, 10 starts per minute (AC11, AC12, AC15); metrics pooled over scored cases, errored cases excluded and not passed (AC16, AC19–AC21); current configuration recorded with skill versions (AC11, AC14); frozen cases, agent deletion cascades (AC4, AC10); creation refusals (AC7); one case per finding with kebab-case name (AC5, AC6); action on every finding card (AC1, EC25); `pnpm verify:l06` plus scripted-model integration test proves the homework criteria (AC26, AC27) | user answer (OQ4–OQ11 accepted) | 2026-10-11 |
| Skill-owned cases (SPEC-06) run through an agent the user picks with the skill linked; agent and skill versions recorded | user answer | 2026-10-11 |
| A name taken in the set gets a `-2`, `-3`, … suffix, so case names are unique per set (SPEC-06 AC8 relies on it) | user answer (cross-spec review, SPEC-06 plan R2) | 2026-10-12 |

## Untrusted inputs

| input | handling | AC |
|---|---|---|
| Frozen diff of the finding's file (PR author's code) | stored as data, size-capped, sent to the model only through the review engine and its injection guard; may contain a live secret, as `pr_files` already does, and never goes to logs | AC4, AC7, AC13 |
| PR title and description (PR author) | cut to 4,000 characters; sent only as the engine's untrusted slots | AC4, AC13 |
| Finding title, category, file, lines (model output of an earlier review) | file and lines must intersect a hunk of the stored diff before a case exists; title becomes a kebab-case name of at most 60 characters; rendered as plain text | AC5, AC7 |
| Model output during an eval run (findings) | grounded against the case's diff; scored only by file and line-range rules; an invalid answer makes the case errored | AC16, AC18, AC21 |
| Agent, case, run and finding ids in requests | must belong to the caller's workspace, else not found and no model request | AC25 |
| Repeated start requests (cost exposure) | one in-progress run per agent; rate-limited | AC12 |

## Open questions

none

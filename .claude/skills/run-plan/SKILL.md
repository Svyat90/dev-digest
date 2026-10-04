---
name: run-plan
description: "Runs one approved Implementation Plan (docs/plans/*.md) end to end from the main session: takes the plan plus an optional spec, designs and extra requirements; preflight (lint-plan, branch, tree, plan and spec status, mode); wave-by-wave implementer dispatch with report acceptance, one wave gate and one commit per task; then architecture-reviewer in parallel with plan-verifier and fix rounds until both pass (2 automatic, then the user decides); doc-writer, insights, plan done. Keeps a resumable Execution log in the plan so work survives /clear. Use when the user types /run-plan or says 'run the plan', 'execute the plan', 'implement docs/plans/…', 'continue the plan', 'resume execution'. Never writes specs or plans: spec-creator and implementation-planner are run by the user separately, before this. Not for reviewing a PR (/pr-self-review)."
metadata:
  version: 2.0.0
---

# Run plan

The main session is the **orchestrator**. It never writes production code or
tests itself: agents do, the orchestrator dispatches them, checks what they
claim, commits their work and keeps the record. Everything an agent cannot do —
ask the user, commit, see the whole tree — is the orchestrator's job.

Agents it runs: `implementer`, `architecture-reviewer`, `plan-verifier`,
`doc-writer` (`.claude/agents/`). It never runs `spec-creator` or
`implementation-planner` — the user runs those separately, before this skill,
and again when this skill says the plan must change. `test-writer` is paused:
implementers write the acceptance test of their own task, and a plan task
marked `Agent: test-writer` is a plan defect (preflight). The plan template:
`docs/plans/README.md`.

## Hard rules

1. **No code by hand.** The orchestrator edits exactly two things: the plan's
   `Status` token and the plan's `## Execution log`. A defect found anywhere —
   in a report, a check, a wave gate — becomes a task for an agent (a fix task,
   step 6), never a quick edit in the main session.
2. **Git.** Run `git branch --show-current` before every commit. Stage each
   task's files by explicit path — never `git add .`, never `git commit -a`;
   the tree may hold unrelated user edits, and they are never staged. One
   commit per task. Never `git push`, `gh pr create` or `gh pr merge`: the user
   runs `/pr-self-review` first (root `CLAUDE.md`).
3. **Reports are claims.** A report is accepted only after the checks in
   `references/report-checks.md`. "Should pass" or a missing command output is
   not evidence.
4. **Agents cannot ask the user** (root `INSIGHTS.md`, 2026-10-03). Every
   `NEEDS_CONTEXT`, `BLOCKED`, `UNVERIFIABLE` and every choice goes to the user
   from here, with options, then back to the agent as a new dispatch.
5. **Two automatic fix rounds, then the user decides.** After round 2 the
   orchestrator never starts round 3 by itself: it shows what is still open
   and asks — one more round, accept as a known gap, or stop.
6. **The plan is the scope.** Extra requirements and designs given to this
   skill refine tasks the plan already has; anything that needs a new task,
   new files or a design change goes back to the user to re-run the planner.
7. **The log is the memory.** Every state change (task accepted, commit made,
   check result, fix round, decision taken by the user) is written to the
   `## Execution log` before the next step. A fresh session resumes from the
   log, not from the conversation (`references/execution-log.md`).
8. **Keep the context small.** Paste no full report into the chat: record the
   one-line result in the log, quote only the lines that need the user's eye.
   Pass the next agent the paths it needs, not the previous agent's output.

## Input

```
/run-plan <plan> [spec=<path>] [designs=<path>[,<path>…]] [mode=multi|single] [<extra requirements, free text>]
/run-plan <plan> resume
```

- `<plan>` — `docs/plans/<date>-<topic>.md`, required. Missing → list
  `docs/plans/` with each `Status` and ask which one.
- `spec=` — the spec the plan was built from. Optional when the plan's
  *Context* already cites it; when both exist they must be the same spec.
- `designs=` — image files, Figma exports or prose design notes in the repo.
  The orchestrator can read images with `Read`; a design that lives only in a
  browser → ask the user for screenshots saved into the repo or the scratchpad.
- Extra requirements — anything else the user writes after the arguments.

## Workflow

Copy this checklist and work through it:

```
Run <plan>:
- [ ] 1. Resume or start
- [ ] 2. Preflight
- [ ] 3. Inputs: spec, designs, extra requirements
- [ ] 4. Run the waves (dispatch → accept → gate → commit, per wave)
- [ ] 5. Checks: architecture-reviewer ∥ plan-verifier
- [ ] 6. Fix rounds (2 automatic, then ask)
- [ ] 7. Docs
- [ ] 8. Close
```

### 1. Resume or start

Read the plan. If it has a `## Execution log`, this is a **resume**:

- Every commit the log lists must exist (`git log --oneline <base>..HEAD`).
  A listed commit that is missing, or a commit on the branch the log does not
  list, is shown to the user before anything runs.
- Continue from the log's `Next:` line. Do not re-dispatch an accepted task.
  The inputs of step 3 are in the log; new ones given now are handled by step 3
  before continuing.

No log → a fresh start; go to step 2.

### 2. Preflight

Stop at the first item that fails and ask the user.

1. **INSIGHTS.** Read root `INSIGHTS.md` and the `INSIGHTS.md` of every package
   the plan touches (root `CLAUDE.md` session protocol); say in one line which
   entries bear on the run.
2. **Plan lint.** `node scripts/lint-plan.mjs <plan> [--spec <spec>]`. Any
   `ERROR` → stop: show the errors and ask the user to re-run
   `implementation-planner` in revision mode (the plan must be `draft` for
   that). `WARN` lines are shown, not blocking. A task with
   `Agent: test-writer` is an error while test-writer is paused.
3. **Plan status.** `approved` → go on. `draft` → show the plan's
   *Recommendations* and *Open questions* and ask the user to approve it as is
   or to revise it with the planner first. `done` → stop: nothing to execute.
4. **Spec status.** The spec (argument or the plan's *Context*): `approved` →
   go on. `draft` with open `OQ`s → stop; the user finishes it with
   `spec-creator` first. Any other status → warn and ask.
5. **Branch.** `git branch --show-current` equals the plan's `Branch:` (plans
   write it bare, in backticks, or with a note such as `(from feature/…)` —
   compare the branch name only). On another branch, ask: switch, create it,
   or update the plan's `Branch:`.
6. **Tree.** `git status --porcelain`. Any path that a task of the plan owns and
   is already modified → ask (keep and let the task build on it, or the user
   stashes it). Unrelated changes are allowed and are never staged (rule 2).
7. **Open questions.** Any plan *Open question* marked `blocks T00x` that has
   no answer in the log → ask it now.
8. **Mode.** `mode=` argument, else the log, else ask single-agent or
   multi-agent.
9. **Environment.** A plan touching `server/` needs `reviewer-core/node_modules`
   (root `INSIGHTS.md`, 2026-09-21): check `ls reviewer-core/node_modules`; if
   absent, ask the user to install it. Integration (`*.it.test.ts`) and e2e
   verification need Postgres / the stack running — ask once, record the answer.
10. **Record.** Set `Status: approved` if it was `draft` and the user approved.
    Create the `## Execution log` (`references/execution-log.md`) with the mode
    and `Base:` = `git rev-parse HEAD` before the first task.

### 3. Inputs: spec, designs, extra requirements

Record each in the log's *Inputs* section before any dispatch.

- **Spec.** Its path goes to `plan-verifier`, which checks every `AC` against
  the shipped code itself, not only through the plan. Implementers get it only
  through the plan.
- **Designs.** Map each design to the plan tasks it shows (a screen → the
  frontend tasks that own its components). Those tasks get `Designs:` in their
  dispatch; `plan-verifier` gets all of them for the UI criteria. A design that
  shows a screen, state or control no task owns → rule 6: list it and ask.
- **Extra requirements.** Split the text into atomic requirements `X1…Xn`.
  For each, decide:
  - **refines a task** (same files, no new contract) → attach it to that task
    as `Extra:` in the dispatch; it becomes an item `plan-verifier` checks;
  - **needs new scope** (a new file, endpoint, contract field, table, task) →
    rule 6: show it with the reason and ask the user to re-run the planner, or
    drop it, or keep it for a later plan;
  - **conflicts** with the spec or the plan → ask which one wins; record the
    answer as a decision.

  Show the classification to the user in one short table before the first
  wave; it is the user's to correct.

### 4. Run the waves

For each wave, in order:

**Dispatch.** Tasks whose `Agent:` is `implementer` (the default) run now;
`doc-writer` tasks are held for step 7. Prompts: `references/dispatch.md`.

- Wave 0 and single-agent mode: one task per message, in task-ID order.
- Multi-agent mode: every `[P]` task of the wave in **one** message, as parallel
  `Agent` calls. Never two tasks that share a file (lint-plan checks it).

**Accept.** Check each report against `references/report-checks.md`. Then:

| Report status | Action |
|---|---|
| `DONE` | accept after the checks |
| `DONE_WITH_CONCERNS` | accept, record the concern in the log; ask the user only if it changes a later task |
| `NEEDS_CONTEXT` | answer from the repo if the answer is a fact; otherwise ask the user. Re-dispatch **that task only** with the answer |
| `BLOCKED` | plan defect → ask the user: re-run the planner (only while the plan is `draft`), or record a decision that changes the task, or stop |

A task re-dispatched twice with the same outcome goes to the user, not a third
time.

**Gate.** Once every task of the wave is accepted, run each touched package's
check **once** for the whole wave (`references/report-checks.md` › Wave gate).
A failure is attributed to the task that owns the failing file and
re-dispatched to it with the failing output; a failure in a file no task owns
goes to the user.

**Commit.** For each task, in task-ID order: `git branch --show-current`, stage
its *Files* by explicit path (plus the generated migration when the task owns
the schema and ran `db:generate`), commit
`<type>(<pkg>): <task title> (T00x)` with the attribution trailer. Record the
short SHA in the log. Then update the log's `Next:` line.

### 5. Checks: architecture-reviewer ∥ plan-verifier

In **one** message, two parallel `Agent` calls (`references/dispatch.md`):

- `architecture-reviewer` — scope: base ref = the log's `Base:`; the plan path.
- `plan-verifier` — the plan path; base = the log's `Base:`; the spec path; the
  designs; the attached `X<n>` requirements; only the *Deviations* and
  *Concerns* lines of the reports, not the full reports.

Record both results in the log's *Checks* table (round 0). Both `PASS` with no
open finding and `VERIFIED` → step 7. Otherwise → step 6.

### 6. Fix rounds (2 automatic, then ask)

Each round:

1. **Pick what to fix.**
   - `architecture-reviewer` CRITICAL and MAJOR findings — always.
   - `plan-verifier` `PARTIAL` / `NOT MET` items — always.
   - MINOR and NIT findings — show them as one numbered list and ask which to
     include (`AskUserQuestion`, multi-select); the rest are recorded as
     declined in the log.
   - `UNVERIFIABLE` items — run the check the verifier said is needed, if it is
     safe and the stack is up; otherwise ask the user.
2. **Fix tasks.** Each picked item becomes a fix task `F<round>.<n>` in the log
   (same fields as a plan task: area, files, `Rules:` and `Constraints:` copied
   from the task that owns the files plus the finding's cited rule, acceptance
   criterion, verify). Findings on the same files share one fix task; two fix
   tasks never share a file.
3. **Run them** exactly as a wave (step 4): dispatch, accept, gate, commit.
4. **Re-check only what was fixed** — in one message:
   `architecture-reviewer` with the fix tasks' files as a path list, and
   `plan-verifier` with `Re-check only:` the failed item IDs. New findings on
   the fixed lines join the next round.
5. **Decide.** Everything passes → step 7. Still open after round 1 → round 2.
   Still open after round 2 → rule 5: show the open items and ask — one more
   round, accept them as known gaps (recorded in the log and in the hand-off),
   or stop.

### 7. Docs

Dispatch the held `doc-writer` tasks, accept, commit. No docs tasks → skip.

### 8. Close

1. **Full check.** `pnpm run typecheck && pnpm test` (or the `npm` equivalent)
   in every touched package, fresh, once (root `CLAUDE.md`). A failure here is
   a fix task, run as in step 6.
2. **Insights.** Invoke the `engineering-insights` skill in `capture` mode with
   the log's *Insight candidates* (collected from every report). Never append
   to an `INSIGHTS.md` without it.
3. **Plan status.** Set the plan's `Status: done`, set the log's `Next:` to
   `none — done`, and commit the plan file alone:
   `docs(plans): mark the <topic> plan done`.
4. **Hand-off.** Report to the user in a few lines: tasks done, commits, fix
   rounds, `X<n>` requirements and their verdicts, anything accepted as a known
   gap. Then the two manual steps that stay with the user:
   - if a spec was used: run `spec-creator` to move it to `implemented`
     (brief: "plan-verifier reported Overall: VERIFIED for <plan>");
   - run `/pr-self-review` before any push or PR. Do not push.

## References

- `references/dispatch.md` — the prompt for each agent.
- `references/report-checks.md` — how to accept a report; the wave gate commands.
- `references/execution-log.md` — the log's format and how to resume from it.

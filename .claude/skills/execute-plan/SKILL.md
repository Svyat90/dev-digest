---
name: execute-plan
description: "Orchestrates the execution of one approved Implementation Plan (docs/plans/*.md) from the main session: preflight (branch, clean tree, plan and spec status, execution mode), wave-by-wave dispatch of implementer / test-writer agents, acceptance of every report, one wave gate and one commit per task, then architecture-reviewer in parallel with plan-verifier, a capped fix loop, doc-writer, insights, and closing the plan and spec statuses. Keeps a resumable Execution log in the plan so work survives /clear. Use whenever the user says 'execute the plan', 'run the plan', 'implement docs/plans/…', 'start wave N', 'continue the plan', 'resume execution', or names a plan file and asks to build it — even if they never name the skill. Not for writing plans (implementation-planner), specs (spec-creator) or reviewing a PR (/pr-self-review)."
metadata:
  version: 1.0.0
---

# Execute plan

The main session is the **orchestrator**. It never writes production code or
tests itself: agents do, the orchestrator dispatches them, checks what they
claim, commits their work and keeps the record. Everything an agent cannot do —
ask the user, commit, see the whole tree — is the orchestrator's job.

Agents: `implementer`, `test-writer`, `architecture-reviewer`, `plan-verifier`,
`doc-writer` (`.claude/agents/`). The plan template: `docs/plans/README.md`.

## Hard rules

1. **No code by hand.** The orchestrator edits exactly two things: the plan's
   `Status` token and the plan's `## Execution log`. A defect found anywhere —
   in a report, a check, a wave gate — becomes a task for an agent (a fix task,
   step 8), never a quick edit in the main session.
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
5. **The fix loop is capped at 2 rounds.** A third round is never started
   automatically: the remaining items go to the user with a recommendation
   (fix by hand, change the plan, accept as a known gap).
6. **The log is the memory.** Every state change (task accepted, commit made,
   check result, fix round, decision taken by the user) is written to the
   `## Execution log` before the next step. A fresh session resumes from the
   log, not from the conversation (`references/execution-log.md`).
7. **Keep the context small.** Paste no full report into the chat: record the
   one-line result in the log, quote only the lines that need the user's eye.
   Pass the next agent the paths it needs, not the previous agent's output.

## Input

A plan path (`docs/plans/<date>-<topic>.md`). Optionally a mode
(`multi-agent` | `single-agent`) and "resume". Missing plan path → list
`docs/plans/` with their `Status` and ask which one.

## Workflow

Copy this checklist and work through it:

```
Execute <plan>:
- [ ] 1. Resume or start
- [ ] 2. Preflight
- [ ] 3. Run the waves (dispatch → accept → gate → commit, per wave)
- [ ] 4. Tests
- [ ] 5. Docs tasks held back
- [ ] 6. Checks: architecture-reviewer ∥ plan-verifier
- [ ] 7. Fix loop (≤ 2 rounds)
- [ ] 8. Docs
- [ ] 9. Close
```

### 1. Resume or start

Read the plan. If it has a `## Execution log`, this is a **resume**:

- Every commit the log lists must exist (`git log --oneline <base>..HEAD`).
  A listed commit that is missing, or a commit on the branch the log does not
  list, is shown to the user before anything runs.
- Continue from the log's `Next:` line. Do not re-dispatch an accepted task.

No log → a fresh start; go to step 2.

### 2. Preflight

Stop at the first item that fails and ask the user.

1. **INSIGHTS.** Read root `INSIGHTS.md` and the `INSIGHTS.md` of every package
   the plan touches (root `CLAUDE.md` session protocol); say in one line which
   entries bear on the run.
2. **Branch.** `git branch --show-current` equals the plan's `Branch:` (plans
   write it bare, in backticks, or with a note such as `(from feature/…)` —
   compare the branch name only). On another branch, ask: switch, create it,
   or update the plan's `Branch:`.
3. **Tree.** `git status --porcelain`. Any path that a task of the plan owns and
   is already modified → ask (keep and let the task build on it, or the user
   stashes it). Unrelated changes are allowed and are never staged (rule 2).
4. **Plan status.** `approved` → go on. `draft` → show the plan's
   *Recommendations* and *Open questions*; the user approves it (or the
   planner revises it first). `done` → stop: nothing to execute.
5. **Spec status.** If the plan cites a spec (`Spec ID: SPEC-NN-…` in its
   *Context*), read that spec's `Status:`. Anything but `approved` →
   warn and ask whether to proceed; a spec with open `OQ`s should go back to
   `spec-creator` first.
6. **Open questions.** Any plan *Open question* marked `blocks T00x` that has
   no answer in the log → ask it now.
7. **Mode.** Ask single-agent or multi-agent when the log has none; the
   planner's report ended with this question, so a recent answer in the
   conversation counts.
8. **Environment.** A plan touching `server/` needs `reviewer-core/node_modules`
   (root `INSIGHTS.md`, 2026-09-21): check `ls reviewer-core/node_modules`; if
   absent, ask the user to install it. Integration (`*.it.test.ts`) and e2e
   verification need Postgres / the stack running — ask once, record the answer.
9. **Record.** Set `Status: approved` if it was `draft` and the user approved.
   Create the `## Execution log` (`references/execution-log.md`) with the mode
   and `Base:` = `git rev-parse HEAD` before the first task.

### 3. Run the waves

For each wave, in order:

**Dispatch.** Tasks whose `Agent:` is `implementer` (the default) or
`test-writer` run now; `doc-writer` tasks are held (step 5). Prompts:
`references/dispatch.md`.

- Wave 0 and single-agent mode: one task per message, in task-ID order.
- Multi-agent mode: every `[P]` task of the wave in **one** message, as parallel
  `Agent` calls. Never two tasks that share a file (the plan guarantees it;
  if the ownership table says otherwise, stop — the plan is defective).

**Accept.** Check each report against `references/report-checks.md`. Then:

| Report status | Action |
|---|---|
| `DONE` | accept after the checks |
| `DONE_WITH_CONCERNS` | accept, record the concern in the log; ask the user only if it changes a later task |
| `NEEDS_CONTEXT` | answer from the repo if the answer is a fact; otherwise ask the user. Re-dispatch **that task only** with the answer |
| `BLOCKED` | plan defect → ask the user: revise the plan (planner, revision mode, only while `draft` — otherwise record the change in the log as a decision) or change the task. test-writer `Defect found` → becomes a fix task (step 7) |

A task re-dispatched twice with the same outcome goes to the user, not a third
time.

**Gate.** Once every task of the wave is accepted, run each touched package's
check **once** for the whole wave (commands: `references/report-checks.md` ›
Wave gate). A failure is attributed to the task that owns the failing file and
re-dispatched to it with the failing output; a failure in a file no task owns
goes to the user.

**Commit.** For each task, in task-ID order: `git branch --show-current`, stage
its *Files* by explicit path (plus the generated migration when the task owns
the schema and ran `db:generate`), commit
`<type>(<pkg>): <task title> (T00x)` with the attribution trailer. Record the
short SHA in the log. Then update the log's `Next:` line.

### 4. Tests

`test-writer` tasks are part of the waves (usually the last one) and run there.
Before leaving the waves, list the spec `AC`s and the plan's acceptance
criteria that no test names (`grep -rn "AC<n>"` in the test files). For a gap
the plan did not assign, ask the user whether to dispatch an on-demand
`test-writer` brief now; plan-verifier runs **after** the tests, because many
criteria are proven by a test.

### 5. Docs tasks held back

`Agent: doc-writer` tasks wait until step 6 passes; their content depends on
what actually shipped.

### 6. Checks: architecture-reviewer ∥ plan-verifier

In **one** message, two parallel `Agent` calls (`references/dispatch.md`):

- `architecture-reviewer` — scope: base ref = the log's `Base:`; the plan path.
- `plan-verifier` — the plan path; base = the log's `Base:`; only the
  *Deviations*, *Concerns* and *Defects found* lines of the reports, not the
  full reports.

Record both results in the log's *Checks* table. Both `PASS` and `VERIFIED` →
step 8. Otherwise → step 7.

### 7. Fix loop (≤ 2 rounds)

1. Turn each `architecture-reviewer` CRITICAL / MAJOR finding and each
   plan-verifier `PARTIAL` / `NOT MET` item into a **fix task** `F<round>.<n>`
   in the log (same fields as a plan task: area, files, acceptance criterion,
   verify). Group findings that touch the same files into one fix task; two
   fix tasks never share a file. MINOR / NIT findings are shown to the user,
   not fixed automatically.
2. `UNVERIFIABLE` items are resolved here: run the check the verifier said is
   needed, if it is safe and the stack is up; otherwise ask the user.
3. Dispatch, accept, gate and commit the fix tasks exactly as in step 3.
4. Re-check **only what failed**: `plan-verifier` with the list of failed item
   IDs, `architecture-reviewer` with the fix tasks' files as a path list.
5. Still failing after round 2 → stop and ask the user (rule 5).

### 8. Docs

Dispatch the held `doc-writer` tasks (step 5), accept, commit. No docs tasks →
skip.

### 9. Close

1. **Full check.** `pnpm run typecheck && pnpm test` (or the `npm` equivalent)
   in every touched package, fresh, once (root `CLAUDE.md`). A failure here is
   a fix task, counted against the round cap.
2. **Insights.** Invoke the `engineering-insights` skill in `capture` mode with
   the log's *Insight candidates* (collected from every report). Never append
   to an `INSIGHTS.md` without it.
3. **Plan status.** Set the plan's `Status: done`, set the log's `Next:` to
   `none — done`, and commit the plan file alone:
   `docs(plans): mark the <topic> plan done`.
4. **Spec status.** If the plan cites a spec, ask the user whether to move it to
   `implemented`. On yes, dispatch `spec-creator` with the spec path and the
   brief "plan-verifier reported Overall: VERIFIED for <plan>, round <n>"; its
   hook asks the user to confirm the status edit.
5. **Hand-off.** Report to the user in a few lines: tasks done, commits, fix
   rounds, anything accepted as a known gap. Ask them to run `/pr-self-review`
   before any push or PR. Do not push.

## References

- `references/dispatch.md` — the prompt for each agent.
- `references/report-checks.md` — how to accept a report; the wave gate commands.
- `references/execution-log.md` — the log's format and how to resume from it.

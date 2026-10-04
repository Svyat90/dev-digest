# Execution log

The orchestrator's record, appended as the last section of the plan file. It is
the only memory a resumed session has (`SKILL.md` rule 6): write it before
moving on, keep each entry to one line, and never paste a report into it.

The planner never touches it: its hook lets it rewrite only a `draft` plan, and
execution starts only on an `approved` one. The log stays uncommitted while the
plan runs and is committed with `Status: done` at the close (`SKILL.md` step
9.3), so it never lands inside a task's commit. Never write a line starting
with `Status:` in the log — the planner hook and `grep -m1 "Status:"` read the
first such line as the plan's status.

## Format

```markdown
## Execution log

Maintained by the `execute-plan` skill. Not part of the plan's design.

- Mode: multi-agent | single-agent
- Base: <sha> (HEAD before the first task)
- Started: YYYY-MM-DD
- Environment: Postgres up | down · stack up | down
- Next: <the one step a resumed session runs first>

### Tasks
| Task | Wave | Agent | Result | Commit | Note |
|---|---|---|---|---|---|
| T001 | 0 | implementer | DONE | abc1234 | — |
| T002 | 1 | implementer | DONE_WITH_CONCERNS | def5678 | concern: … |

### Wave gates
- W0 — pass (server typecheck, unit tests, arch:check)
- W1 — fail → T002 re-dispatched · pass on retry

### Decisions
- YYYY-MM-DD — <question asked> → <user's answer> (affects T00x)

### Checks
| Round | architecture-reviewer | plan-verifier | Open items |
|---|---|---|---|
| 0 | PASS | GAPS (MET 14 · NOT MET 1) | T003 · AC2 |

### Fix tasks
#### F1.1 — <title>
- Source: plan-verifier T003 · AC2 NOT MET — <evidence>
- Area: backend | frontend
- Files (exclusive): `<path>` (modified)
- Acceptance criterion: <the failed item's own wording>
- Verify: `<command>`
- Result: DONE · <sha>

### Insight candidates
- T002: <candidate> — `<path>`
```

## Rules

- `Next:` is rewritten after every step, and a row's *Result* / *Commit* cells
  are filled in place as the task moves on; everything else is append-only.
- A task row with Commit `—` was accepted but is not committed yet; whether its
  wave gate passed is in *Wave gates*.
- Round 0 is the first check run; fix rounds are 1 and 2 (`SKILL.md` rule 5).
- A fix task carries the same fields as a plan task, so the implementer can
  run it with the plan header as context.
- Dates come from `date +%F`, never from memory.

## Resuming

1. Read the plan header and the log, not the conversation.
2. `git log --oneline <Base>..HEAD` must list exactly the log's commits;
   anything else goes to the user before work continues.
3. `git status --porcelain`: uncommitted files of an accepted-but-uncommitted
   task are committed first if *Wave gates* records a pass for that wave;
   otherwise run the gate first.
4. Run the `Next:` step.

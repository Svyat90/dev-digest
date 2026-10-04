# Accepting a report

A report is a claim (`SKILL.md` rule 3). Accept it only when every check of its
agent passes; a failed check means re-dispatching the same task with the
reason. Read the report, not the agent's whole transcript.

## implementer / test-writer

1. **Shape.** All fields of the agent's report template are present and
   `Status:` holds exactly one value.
2. **Files.** `git status --porcelain -- <task Files>` shows every file the
   report lists, and *Files changed* ⊆ the task's *Files*. Any other path
   changed since the wave started that no task of the wave owns → ask the
   agent's owner (re-dispatch) or the user; never commit it.
3. **Rules.** *Rules applied* is `all`, or each skipped `Rules:` line has a
   reason you accept; a skipped line without one → re-dispatch. *Skills
   loaded* is `none` for a task that has `Rules:` (a whole-skill load there
   means the agent ignored the field — accept the work, note it in the log).
   A task without `Rules:` (legacy) must list every skill of its area.
   Copy each *Rules gap* to the log's *Rules gaps* list — they tell the next
   plan what its Rules missed.
4. **Verification.** Each line of the task's *Verify* appears with its output:
   the `PASS` / `FAIL` / `SKIP` lines of `verify-task.sh`, `own 0` on every
   step. A bare "passes" is not evidence.
5. **Foreign errors.** Each file in a `foreign` count is owned by another
   task of the running wave. A foreign error in a file nobody in the wave owns is a real
   problem — raise it at the wave gate.
6. **Test-writer extras.** *Fail-first evidence* has a failing assertion line
   per test; *Mutation check* has at least one `executed` entry, or says why
   none was permitted. `Defects found` other than "none" → a fix task.
7. **Collect.** Copy *Deviations*, *Concerns*, *Rules gaps* and *Insight
   candidates* (non-"none" only) to the log, one line each.

## architecture-reviewer

- `Status:` `PASS` | `BLOCKED` | `NEEDS_CONTEXT`.
- Each finding has `file`, `line`, a quoted `rule` and `confidence` ≥ 80.
- A finding on a line no task changed, or on baseline debt, is dropped and
  the drop is noted in the log (the reviewer's own Hard rules 5 and 8).
- An environment line (missing `reviewer-core/node_modules`) is not a finding.

## plan-verifier

- `Overall:` `VERIFIED` | `GAPS` | `NEEDS_CONTEXT`.
- Every non-`MET` row has evidence or a stated "what would verify it".
- *Scope creep* entries: a file the user changed by hand on purpose is
  confirmed with the user and recorded as a decision; anything else is a fix
  task (remove it) or a plan amendment the user approves.
- *Reports contradicted* entries are always shown to the user.

## doc-writer

- Every *Files changed* path is a documentation path (never `INSIGHTS.md`,
  `docs/plans/**`, `.claude/**`).
- *Claims verified* has a `path:line` per claim.

# Wave gate

Run once per wave, in each package the wave touched, **after** all its tasks
are accepted and **before** any commit, from the repo root:

```
scripts/verify-task.sh <server|client|reviewer-core|mcp> --gate   # add --it when a task of the wave owns *.it.test.ts and Postgres is up
```

`--gate` counts every error as a failure (no own/foreign split): the whole
wave is in the tree now. The script prints one line per step and at most 40
failure lines; re-run a single failing file without it to read the failure in
full. `e2e`: only the flow the wave added, and only when the stack is up
(preflight answer).

Attributing a failure: the file in the error line belongs to exactly one task
of the wave (the ownership table) — re-dispatch that task with those lines.

`typecheck` in `server/` and `reviewer-core/` does not cover `test/`
(root `INSIGHTS.md`, 2026-09-26). When the wave added or changed test files
there, type-check them with a scratch tsconfig in the session scratchpad that
`extends` the package one and adds `test/**`.

Use `pnpm run <script>`, never `pnpm -s` (root `INSIGHTS.md`).

# Implementation plans

Working plans written by the `implementation-planner` agent
(`.claude/agents/implementation-planner.md`) and executed by `implementer` agents (`.claude/agents/implementer.md`), with
`test-writer`, `architecture-reviewer`, `plan-verifier` and `doc-writer` agents
(`.claude/agents/{test-writer,architecture-reviewer,plan-verifier,doc-writer}.md`)
closing the loop after implementation. A plan is a working document for one
feature branch; lasting behaviour belongs in `<package>/specs/` once the
feature ships.

File name: `YYYY-MM-DD-<kebab-topic>.md`.

## How a plan is executed

Three steps, each started by the user:

1. **Spec** — the user runs `spec-creator` (answers its questions, approves the
   spec).
2. **Plan** — the user runs `implementation-planner` with the spec. It writes a
   `draft` plan here, or returns `NEEDS CLARIFICATION`; accepted
   *Recommendations* go in through a planner revision run, never by hand. Only
   a `draft` plan can be revised. `node scripts/lint-plan.mjs <plan>` runs on
   every plan write.
3. **Build** — the user runs
   `/run-plan <plan> [spec=…] [designs=…] [mode=multi|single] [extra requirements]`
   ([`.claude/skills/run-plan/SKILL.md`](../../.claude/skills/run-plan/SKILL.md)
   holds the full protocol): preflight, waves of `implementer` agents (one
   wave gate and one commit per task), `architecture-reviewer` ∥
   `plan-verifier`, fix rounds (two automatic, then the user decides),
   `doc-writer`, insights, `Status: done`. It never runs `spec-creator` or the
   planner; it tells the user when one must be re-run. Moving the spec to
   `implemented` and `/pr-self-review` stay with the user.

`test-writer` is paused: implementers write the acceptance test of their own
task, and plans contain no `Agent: test-writer` task.

While a plan runs, its last section is an `## Execution log` kept by
`run-plan` (inputs, mode, base commit, task results and commits, decisions,
check rounds, fix tasks). A fresh session resumes from it.

## Template

````markdown
# <Feature name> — Implementation Plan

Date: YYYY-MM-DD · Branch: feature/<lNN>-<topic> · Status: draft | approved | done

## Goal
<1–3 sentences: what the user gets when this ships.>

## Context
- Request: <the ask, in one line>
- INSIGHTS entries that apply: <entry title — path>
- Spec invariants that apply: <e.g. server/specs/skills.md S3>
- Closest existing feature followed: <path>

## Requirements review
<Unclear / contradictory / missing / already there — or "nothing unclear,
contradictory or missing". Every spec `AC` id and the task that covers it.>

## Assumptions
- <point settled by a default instead of a question, and why> (or "none")

## Recommendations
- <how to do it better> — why: … · cost: … (not part of Scope until the user
  accepts it; or "none")

## Scope
- In: …
- Out: …

## Design
<Rings / folders each piece lives in, with the reason from the architecture skill.>

```mermaid
<data flow>
```

### Contracts
<New / changed shapes; both `server/src/vendor/shared/...` and `client/src/vendor/shared/...` named.>

### Database
<Tables, columns, indexes, `workspace_id`; migration via `pnpm run db:generate`. "None" if none.>

## Global constraints
- Zod 3 only · no do-not-touch paths · tests per TESTING.md · <feature-specific rules>

## Tasks

### Wave 0 — foundation (sequential)

#### T001 — <title>
- Area: backend | frontend
- Agent: implementer | doc-writer (default `implementer` when omitted; `test-writer` is paused)
- Depends on: —
- Files (exclusive):
  - `server/src/vendor/shared/contracts/x.ts` (modified)
  - `client/src/vendor/shared/contracts/x.ts` (modified)
- Skills: <skill → sections, from routing.md>
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - <one concrete, checkable rule for these files> — <skill> §<section>
  - <e.g. the repository owns the transaction; the service never opens one> — onion-architecture §6
- Interface (only when another task calls what this task exports, or this task calls another's export):
  - `<name>(<param>: <Type>, …): <ReturnType>` — exported here | (from T00x)
- Steps:
  1. <test to write, and what it asserts>
  2. <change>
- Acceptance criteria:
  - <observable behaviour / shape>
- Verify (one line per touched package; add task-specific checks below it):
  - `scripts/verify-task.sh server server/src/vendor/shared/contracts/x.ts`
  - `scripts/verify-task.sh client client/src/vendor/shared/contracts/x.ts`
- Constraints (quoted, not just referenced — the agent does not read the whole INSIGHTS file):
  - <INSIGHTS entry title> — Rule: <its rule line> — `<package>/INSIGHTS.md` (<date>)
  - <spec invariant / AC id and its wording>

### Wave 1 — parallel

#### T002 [P] — <title>
…

### Wave 2 — integration

#### T00N — <title>
…

## Ownership check
| File | Task |
|---|---|
| … | T00x |

## Risks
- <risk> → <mitigation>

## Open questions
- <question> (blocks T00x | does not block)
````

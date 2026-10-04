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

The main session runs the plan with the `run-plan` skill
([`.claude/skills/run-plan/SKILL.md`](../../.claude/skills/run-plan/SKILL.md)),
which holds the full protocol. In short:

1. `implementation-planner` writes a `draft` plan here, or returns
   `NEEDS CLARIFICATION`; the main session asks the user and re-runs it.
   Accepted *Recommendations* go in through a planner revision run, never by
   hand. Only a `draft` plan can be revised.
2. The user approves the plan and picks the execution mode (multi-agent: `[P]`
   tasks of a wave in parallel; single-agent: one task at a time, in task-ID
   order). The main session sets `Status: approved`.
3. `run-plan` works wave by wave on the current feature branch, in one
   working tree: dispatch by each task's `Agent:` field, accept every report,
   one wave gate, one commit per task. `doc-writer` tasks wait until the
   checks pass.
4. After the last wave (tests included): `architecture-reviewer` ∥
   `plan-verifier`, then at most two fix rounds that re-check only what failed.
5. Close: full typecheck and tests, `engineering-insights` capture,
   `Status: done`, the spec moved to `implemented` with the user's consent, and
   the user runs `/pr-self-review` before any push or PR.

While a plan runs, its last section is an `## Execution log` kept by
`run-plan` (mode, base commit, task results and commits, decisions, check
rounds, fix tasks). A fresh session resumes from it.

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
- Agent: implementer | test-writer | doc-writer (default `implementer` when omitted)
- Depends on: —
- Files (exclusive):
  - `server/src/vendor/shared/contracts/x.ts` (modified)
  - `client/src/vendor/shared/contracts/x.ts` (modified)
- Skills: <skill → sections, from routing.md>
- Rules (applied by the agent instead of loading the skills; 5–15 lines):
  - <one concrete, checkable rule for these files> — <skill> §<section>
  - <e.g. the repository owns the transaction; the service never opens one> — onion-architecture §6
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

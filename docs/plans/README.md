# Development plans

Working plans written by the `planner` agent (`.claude/agents/planner.md`) and
executed by `implementer` agents (`.claude/agents/implementer.md`). A plan is a
working document for one feature branch; lasting behaviour belongs in
`<package>/specs/` once the feature ships.

File name: `YYYY-MM-DD-<kebab-topic>.md`.

## How a plan is executed

1. The main session runs `planner` → a plan file here.
2. The user reviews the plan.
3. The main session works wave by wave on the **current feature branch, in one
   working tree** (no worktrees, no per-task branches):
   - Wave 0 tasks run one at a time.
   - `[P]` tasks of a wave are launched as parallel `implementer` agents in a
     single message. They never share a file (the planner guarantees it).
   - After a wave, the main session checks each report (status, skills loaded vs.
     the task's *Skills*, verification output), runs the package typecheck and
     tests once for the whole wave, and commits **one commit per task**, staging
     that task's *Files* by explicit path after `git branch --show-current`.
   - `NEEDS_CONTEXT` / `BLOCKED` → resolve with the user or fix the plan, then
     re-dispatch that task only.
4. After the last wave: `pnpm run typecheck && pnpm test` in every touched
   package, insight candidates recorded through the `engineering-insights`
   skill, then the user runs `/pr-self-review` before any push or PR.

## Template

````markdown
# <Feature name> — Development Plan

Date: YYYY-MM-DD · Branch: feature/<lNN>-<topic> · Status: draft | approved | done

## Goal
<1–3 sentences: what the user gets when this ships.>

## Context
- Request: <the ask, in one line>
- INSIGHTS entries that apply: <entry title — path>
- Spec invariants that apply: <e.g. server/specs/skills.md S3>
- Closest existing feature followed: <path>

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
- Depends on: —
- Files (exclusive):
  - `server/src/vendor/shared/contracts/x.ts` (modified)
  - `client/src/vendor/shared/contracts/x.ts` (modified)
- Skills: <skill → sections, from routing.md>
- Steps:
  1. <test to write, and what it asserts>
  2. <change>
- Acceptance criteria:
  - <observable behaviour / shape>
- Verify:
  - `cd server && pnpm run typecheck`
  - `cd client && pnpm run typecheck`
- Constraints: <INSIGHTS / spec entries this task must respect>

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

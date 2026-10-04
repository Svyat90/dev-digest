# specs — cross-package

Written feature specs for features that change **two or more packages**
(`server`, `client`, `reviewer-core`, `e2e`). A spec that touches one package
lives in that package's `specs/` folder instead — `server/specs/`,
`client/specs/`, `reviewer-core/specs/` (and `e2e/docs/` for e2e, because
`e2e/specs/` holds flow JSON).

Specs here are written by the [`spec-creator`](../.claude/agents/spec-creator.md)
agent and follow one template: problem and user, goals / non-goals, user
stories, EARS acceptance criteria, edge cases, non-functional requirements,
inputs and provenance, untrusted inputs, open questions. A spec answers *what*
the feature must do and *why*; *how* and the order of work belong to the plan
(`docs/plans/`).

Header of every spec: `Spec ID`, `Status`, `Supersedes`, `Packages`,
`Depends on`. Ids inside a spec: `US1…` stories, `AC1…` acceptance criteria
(each names its story, e.g. `[US1]`), `EC1…` edge cases (each names the `AC` that
covers it), `OQ1…` open questions (each has an owner). Check one with
`node scripts/lint-spec.mjs <spec>`.

## Naming

- Spec ID: `SPEC-<NN>-<slug>`, e.g. `SPEC-07-blast-radius`.
- File: `<NN>-<slug>-<YYYY-MM-DD>.md`, e.g. `07-blast-radius-2026-10-03.md`.
  The date is the day the spec was first created; it never changes afterwards.
- `NN` is one repo-wide counter across `specs/`, `<pkg>/specs/` and
  `e2e/docs/`: highest existing number plus one.
- `<slug>` is 1–3 lowercase words naming the feature — not a lesson, a date or
  a status.
- Specs written before this convention (`BR1…`, `C1…`, `SD1…` invariants) keep
  their format and have no ID.

## Lifecycle

`draft` → `approved` → `implemented`, and `superseded` for a spec replaced by a
newer one. The agent only proposes a status change; the user is asked to allow
every one. `approved` needs no open questions; `implemented` follows a
`plan-verifier` `VERIFIED`. A change to an approved or implemented spec is a new
spec with `Supersedes:` pointing at the old one. A spec larger than ~25
acceptance criteria is split in two.

## Workflow: from idea to shipped feature

Which agent runs when, in order. Each step starts only when the gate of the
previous one is passed. Agent rules live in
[`.claude/agents/README.md`](../.claude/agents/README.md); the plan protocol is in
[`docs/plans/README.md`](../docs/plans/README.md).

| # | Who | What it does | Gate before the next step |
|---|-----|--------------|---------------------------|
| 0 | `brainstorm` skill (optional) | Compares the idea's options and records the decision in `brainstorm/ideas.md` | You picked an option |
| 1 | `researcher` (optional) | Finds facts in the repo or on the web the spec will lean on | You have the facts you need |
| 2 | `spec-creator` | One run: reads the brief and designs, finds gaps, writes the spec as `draft` with every undecided point as an open question, and returns up to 4 ready-to-ask questions. A hook lints every write | Lint passes; the questions are back in the main session |
| 3 | You + main session | The main session asks you the questions (`AskUserQuestion` is not available inside subagents) and runs `spec-creator` again with your answers; it revises the same file. Repeat until no open question is left | You say `approved`; `spec-creator` proposes it and the hook asks your permission |
| 4 | `implementation-planner` | Reads the approved spec, asks what is unclear, writes the plan in `docs/plans/`; every `AC` is covered by a task | You review the plan and choose single- or multi-agent execution |
| 5 | `implementer` × N and `test-writer` | Build and test the plan's tasks in waves; tests are named after the `AC` they check | Every task done |
| 6 | `architecture-reviewer` ∥ `plan-verifier` | Check boundaries and check every plan item and `AC` against the shipped code | Both pass; otherwise fix tasks go back to step 5 |
| 7 | `spec-creator` | Proposes `approved` → `implemented`, citing the `VERIFIED` report | You allow the status change |
| 8 | `doc-writer` | Explains how the shipped feature works in `<pkg>/docs/` and links the SPEC; never edits the SPEC or writes a second invariants spec for it | Docs written, indexes updated |
| 9 | `engineering-insights` | Captures what the work taught; writes nothing when nothing qualifies | Done |
| 10 | You | Run `/pr-self-review`, then push and open the PR | A verdict other than `BLOCKED` |
| 11 | You (optional) | Run `/workflow-retro` to measure the run (tokens, agents, order, errors, duplicated work) and get proposed changes to agents and skills in `docs/retros/`; manual only, never run by an agent or skill | Report read |

Rules of the flow:

- A spec that needs a change after `approved` is not edited — write a new spec
  with `Supersedes:`, and `spec-creator` proposes `superseded` for the old one.
- A feature too small for a spec (a one-file fix) skips steps 2–3 and 7; the
  planner then works from the request alone.
- Specs written before this flow (`BR1…`, `C1…`, `SD1…`) are never edited by
  `spec-creator`; a change to one is a new spec that supersedes it.

## Index

| ID | Spec | Status | Packages |
|----|------|--------|----------|
| SPEC-01-project-context | [Project Context — discovery and attachment](01-project-context-2026-10-03.md) | approved | server, client |
| SPEC-02-context-injection | [Project Context — run-time injection and trace](02-context-injection-2026-10-03.md) | approved | server, reviewer-core, client |
| SPEC-03-pr-brief | [PR Brief — PR why and risk brief](03-pr-brief-2026-10-04.md) | approved | server, client |

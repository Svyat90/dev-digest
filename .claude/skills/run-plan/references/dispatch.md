# Dispatch prompts

One prompt per agent. Fill the `<…>` slots; add nothing else. Each agent reads
its own rules from `.claude/agents/<name>.md` and the plan from disk, so the
prompt carries **paths and decisions**, never pasted plan text or another
agent's report. Lines in `[…]` are included only when they apply.

## implementer — a plan task

```
Plan: <plan path>
Task: <T00x>
Read: header lines 1–<line before "## Tasks">, task lines <start>–<end>
Mode: <multi-agent | single-agent>
[Designs: <paths of the designs mapped to this task> — match them for the files you own; anything they show outside your Files is not yours]
[Extra: X<n> — <the requirement, verbatim>   (one line each; treat as an acceptance criterion of this task)]
[Previous attempt: <status> — <the one-line reason>]
[Answer / decision from the user: <text>]
[Gate failure to fix: <failing command + the lines that name your files>]
```

Multi-agent: say nothing about other tasks; the agent already treats errors in
files it does not own as *Foreign errors*.

`Read:` ranges come from one `grep -n -E "^#{2,4} " <plan>` per wave: the
header ends on the line before `## Tasks`; a task runs from its `#### T00x`
line to the line before the next `##`, `###` or `####` heading (e.g.
`### Wave 2`, `## Ownership check`). Recompute them each wave — the Execution
log grows. Fix tasks get no `Read:` line. Without them each implementer reads the whole plan, often 2–3 times
(retro 2026-10-04: an 857-line plan read by 8 agents).

## implementer — a fix task

Fix tasks live in the plan's `## Execution log › Fix tasks`, not in *Tasks*.

```
Plan: <plan path>
Task: <F1.2> — read it under "## Execution log › Fix tasks"; the plan header
(Goal, Context, Design, Global constraints) still applies.
Source: <architecture-reviewer finding | plan-verifier item> — <rule or criterion, file:line>
[Designs: <paths>, when the item is a UI criterion]
```

## architecture-reviewer

Round 0:

```
Scope: base ref <Base sha from the log>
Plan: <plan path>
```

Fix rounds:

```
Scope: paths <files of the fix tasks of this round>
Plan: <plan path>
```

## plan-verifier

Round 0:

```
Plan: <plan path>
Base: <Base sha from the log>
[Spec: <spec path> — check every AC against the shipped code, not only through the plan's tasks]
[Designs: <paths> — the UI criteria are checked against them]
[Extra requirements (part of the scope, attached to tasks):
- X1 → T004: <verbatim>]
Report claims to check:
- T00x: Deviations: <…> · Concerns: <…>   (only non-"none" lines)
Note: the plan file's own "## Execution log" and Status token are the
orchestrator's; they are not scope creep.
```

Fix rounds:

```
Plan: <plan path>
Base: <Base sha from the log>
Re-check only: <R2, T003 · AC2, X1, …>   (the items that were PARTIAL / NOT MET / UNVERIFIABLE)
Fix tasks applied: <F1.1, F1.2> — see "## Execution log › Fix tasks"
[Spec / Designs: as in round 0, when a re-checked item comes from them]
```

## doc-writer

```
Mode: write
Plan: <plan path>
Task: <T00x>
Shipped: plan-verifier VERIFIED (round <n>), architecture-reviewer PASS
```

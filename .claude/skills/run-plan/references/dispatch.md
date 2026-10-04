# Dispatch prompts

One prompt per agent. Fill the `<…>` slots; add nothing else. Each agent reads
its own rules from `.claude/agents/<name>.md` and the plan from disk, so the
prompt carries **paths and decisions**, never pasted plan text or another
agent's report.

## implementer / test-writer — a plan task

```
Plan: <plan path>
Task: <T00x>
Mode: <multi-agent | single-agent>
<only when re-dispatching:>
Previous attempt: <status> — <the one-line reason>
Answer / decision from the user: <text>
Gate failure to fix: <failing command + the 1–10 output lines that name your files>
```

Multi-agent: say nothing about other tasks; the agent already treats errors in
files it does not own as *Foreign errors*.

## implementer — a fix task

Fix tasks live in the plan's `## Execution log › Fix tasks`, not in *Tasks*.

```
Plan: <plan path>
Task: <F1.2> — read it under "## Execution log › Fix tasks"; the plan header
(Goal, Context, Design, Global constraints) still applies.
Source: <architecture-reviewer finding | plan-verifier item> — <rule or criterion, file:line>
```

## test-writer — an on-demand brief

```
Brief: cover <behaviour>, spec <AC ids>.
Production files under test: <paths>
Test files you may create/edit: <paths>
Plan (context only): <plan path>
```

## architecture-reviewer

First run:

```
Scope: base ref <Base sha from the log>
Plan: <plan path>
```

Re-check after a fix round:

```
Scope: paths <files of the fix tasks of this round>
Plan: <plan path>
```

## plan-verifier

First run:

```
Plan: <plan path>
Base: <Base sha from the log>
Report claims to check:
- T00x: Deviations: <…> · Concerns: <…> · Defects found: <…>   (only non-"none" lines)
Note: the plan file's own "## Execution log" and Status token are the
orchestrator's; they are not scope creep.
```

Re-check after a fix round:

```
Plan: <plan path>
Base: <Base sha from the log>
Re-check only: <R2, T003 · AC2, …>   (the items that were PARTIAL / NOT MET / UNVERIFIABLE)
Fix tasks applied: <F1.1, F1.2> — see "## Execution log › Fix tasks"
```

## doc-writer

```
Mode: write
Plan: <plan path>
Task: <T00x>
Shipped: plan-verifier VERIFIED (round <n>), architecture-reviewer PASS
```

## spec-creator — status to implemented

```
Revision: <spec path>
Brief: plan-verifier reported Overall: VERIFIED for <plan path> (round <n>).
Propose the status change approved → implemented. Change nothing else.
```

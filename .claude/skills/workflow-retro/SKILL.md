---
name: workflow-retro
description: "Manual only — the user runs /workflow-retro; never invoke it on your own. Retrospective of one multi-agent workflow run in the current (or a named) Claude Code session: a script reads the session and subagent transcripts and counts tokens, cache hit ratio, cost, agents and their launch order, dispatches and resumes, parallelism, tool calls, errors, hook blocks, repeated and shared reads, and human friction; the model then reads each agent's brief and report to judge what was hard, what was easy, what was duplicated and what was missed, checks the reports' claims against the tree, and writes a dated report to docs/retros/ with recommendations as proposed diffs to agents and skills. Read-only apart from that report and one metrics row; applies nothing."
metadata:
  version: 1.0.0
disable-model-invocation: true
---

# Workflow retro

A workflow that ran well and one that ran badly can end in the same commit.
The difference is in the transcripts: how many tokens it burned, which agent
re-read what the brief already said, which report claimed a check it never ran,
which question the user had to answer twice. This skill turns one run into
numbers plus a short list of changes to the agents that would make the next run
cheaper, faster or more correct.

It runs only when the user types `/workflow-retro`. It is never a step of
another skill or agent.

## Hard rules

1. **Read-only.** Write exactly two things: the report file and one row in
   `docs/retros/metrics.csv`. Never edit an agent, skill, spec, plan or
   `INSIGHTS.md`; recommendations are proposed diffs the user applies.
2. **Numbers come from the script.** Every count, token figure, duration and
   order in the report is copied from `collect.mjs` output. Never estimate a
   number the script can produce; if it cannot, say "not measured".
3. **Reports are claims.** An agent's "tests pass" or "lint clean" is checked
   against the tree (step 4) before the report calls it a strength.
4. **Evidence for every judgement.** Each finding cites an agent (`type#order`),
   a tool call, a file path or a quoted report line. No finding without one.
5. **No secrets, no user data.** The report is committed. Never copy env
   values, tokens, keys or the user's free text beyond a short quote that is
   needed as evidence. Use absolute paths only under the repo, as
   repo-relative paths.

## Input

```
/workflow-retro [session=<id|path>] [since=<ISO>] [until=<ISO>] [topic=<kebab-slug>] [prices=<path>]
```

- `session` — default: the current session (the newest transcript of this project).
- `since` / `until` — narrow a long session to one workflow (for example, from
  the first agent launch of a `run-plan`).
- `topic` — names the report file; default: the branch name without `feature/`.
- `prices` — USD per million tokens per model; default
  `.claude/skills/workflow-retro/references/prices.json`. Cost is omitted when
  a model's price is missing — never guess a price.

## Steps

Copy this checklist and work through it:

```
Retro:
- [ ] 1. Collect metrics
- [ ] 2. Read briefs and reports
- [ ] 3. Judge each agent
- [ ] 4. Check claims against the tree
- [ ] 5. Find cross-agent waste and gaps
- [ ] 6. Write recommendations
- [ ] 7. Write the report and the metrics row
```

**1. Collect.** Run, from the repo root:

```sh
node .claude/skills/workflow-retro/scripts/collect.mjs [--session …] [--since …] [--until …] \
  --prices .claude/skills/workflow-retro/references/prices.json > "$SCRATCH/retro.json"
```

Save the output to the scratchpad, not the repo. Read it with `jq` slices
rather than in full; a 30-agent run produces a large file. What it measures is
in `references/metrics.md`.

**2. Read briefs and reports.** For each agent, read its brief (the first user
message of `<session>/subagents/agent-<id>.jsonl`) and `reports[]` from the
script output. Read the transcript body only where a metric points at trouble:
errors, hook blocks, a high `toolCallsBeforeFirstWrite`, repeated reads,
`DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED`, `GAPS`, a resume.

**3. Judge each agent** on four questions, with evidence:

| Question | Where it shows |
|---|---|
| What was hard? | errors and their kind, hook blocks, resumes, a long ramp-up before the first write, open questions, concerns in the report |
| What was easy? | first-dispatch `DONE`, few tool calls, no errors, no resume |
| What was duplicated? | `repeatedReads`, `sharedReads`, facts the brief already held that the agent searched for again, the same check run by two agents |
| What was missed? | an item the verifier or reviewer found that the implementer's report did not mention; a question the user had to answer later that the agent could have raised; a skill the task needed but the agent never loaded |

**4. Check claims.** For each report that claims files changed, a lint or a
test result: confirm the files exist in `git status` or the branch's commits,
and re-run a claimed check only when it is cheap (a lint, one test file). A
claim that does not hold is a finding, not a footnote.

**5. Cross-agent view.**
- Order and parallelism: the `timeline`, `maxConcurrent`; agents that ran one
  after another with no dependency between them.
- Token split: main vs agents (`agentShare`), the most expensive agent, cache
  hit ratio per agent; a low ratio on a resumed agent means a cold restart.
- Human friction: questions asked vs calls (one question per call means
  ping-pong), rejected tool calls, clarifications the user asked for, and how
  many recommended options the user accepted unchanged (high → make them
  defaults).

**6. Recommendations.** At most seven, highest impact first. Each one names the
file to change (`.claude/agents/<name>.md`, a skill, a hook, a brief template),
the change as a short diff or exact sentence, the metric it should move, and
the evidence that motivated it. Skip anything that would only restate a rule
already in the agent's file — point at the rule the agent ignored instead.

**7. Write.**
- Report: `docs/retros/<YYYY-MM-DD>-<topic>.md`, using
  `references/report-template.md`. Create `docs/retros/` if it is missing.
- Metrics row: append to `docs/retros/metrics.csv` (create it with the header
  from `references/metrics.md` if missing). One row per retro.
- Reply in chat with the five-line summary from the template's top and the
  report path. Offer, in one line, to run `engineering-insights` capture on
  findings that pass its gate; do not run it unasked.

## Not this skill

- Reviewing code quality or architecture — `/pr-self-review`,
  `architecture-reviewer`.
- Checking a plan's items against the code — `plan-verifier`.
- Capturing package knowledge — `engineering-insights`.

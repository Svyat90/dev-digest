# Agents

Project subagents for DevDigest. This file is a map of the set: what each agent
is for, what it may touch, and what goes in and comes out. The rules themselves
live in each agent file — read that file before changing an agent.

## At a glance

| Agent | Model | Responsibility | Writes | Runs |
|-------|-------|----------------|--------|------|
| [researcher](researcher.md) | sonnet | Find facts in the repo or on the web | nothing | alone, on demand |
| [planner](planner.md) | opus | Turn a feature request into a Development Plan | one plan file | once per feature |
| [implementer](implementer.md) | sonnet | Implement one plan task, backend or frontend | the task's own files | many in parallel |

Flow: `researcher` (optional) → `planner` → user reviews the plan →
`implementer` × N, wave by wave → main session commits → user runs `/pr-self-review`.
The execution protocol and the plan template: [`docs/plans/README.md`](../../docs/plans/README.md).

## researcher

- **Responsibility:** answer one concrete question about the codebase, its
  history, or external libraries/standards. Never changes anything.
- **Permissions:** `Read, Grep, Glob, Bash, WebSearch, WebFetch`. Bash is
  read-only by rule (no redirects, installs, git writes, DB or docker). No
  `Agent`, no deep-research fan-out.
- **Input:** a precise brief. The caller interviews the user first
  (AskUserQuestion) when the request is vague about scope, target or depth.
- **Output:** a report in a fixed structure — mode (project / web / mixed),
  status `FOUND | PARTIAL | NOT FOUND | NEEDS CLARIFICATION`, confidence,
  findings with `path:line` or URL + date, and an explicit *Not found* list.

## planner

- **Responsibility:** read curated knowledge, load the skills, explore the code
  and write a Development Plan that implementers can run in parallel on one
  feature branch. Never writes code.
- **Permissions:** `Read, Grep, Glob, Bash, Skill, Write`. `Write` only for
  `docs/plans/<YYYY-MM-DD>-<topic>.md`; Bash read-only. No `Edit`, no `Agent`.
- **Skills:** the same backend and frontend sets as the implementer, loaded by
  explicit `Skill` calls for every area the feature touches; plus
  `engineering-insights` (read) and `mermaid-diagram`.
- **Input:** a feature request, optionally a researcher report.
- **Output:**
  - `docs/plans/<date>-<topic>.md` — goal, context (INSIGHTS / spec entries),
    scope, design with a Mermaid diagram, contracts, DB, and tasks `T001…`
    grouped in waves, each with area, exclusive files, dependencies, `[P]`,
    skills, acceptance criteria and verify commands, plus an ownership table;
  - a short status to the caller: `PLANNED | NEEDS CLARIFICATION`, wave counts,
    skills loaded, open questions.

## implementer

- **Responsibility:** implement exactly one task of a plan — backend
  (`server/`, `reviewer-core/`) or frontend (`client/`, `e2e/`) — test-first,
  verified, inside the task's own files. Several instances share one working
  tree on the current feature branch.
- **Permissions:** `Read, Edit, Write, Grep, Glob, Bash, Skill`. No git writes
  (the main session commits), no installs, no `db:migrate` / `db:seed` /
  docker; `db:generate` only when the task owns the schema. No `Agent`. Does not
  write `INSIGHTS.md`.
- **Skills (all mandatory for the area, loaded before any code):**
  - backend — `onion-architecture`, `fastify-best-practices`,
    `drizzle-orm-patterns`, `postgresql-table-design`, `zod`,
    `typescript-expert`, `security`;
  - frontend — `frontend-ui-architecture`, `react-best-practices`,
    `next-best-practices`, `react-testing-library`, `zod`,
    `typescript-expert`, `security`.
- **Input:** a plan path and a task ID.
- **Output:** the task's files changed in the working tree (uncommitted) and a
  report: status `DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`, skills
  loaded, routing rows applied, files changed, verification commands with
  results, foreign errors, deviations, insight candidates.

## Shared rules

- **One skill map.** Which skill sections apply to which files is defined once,
  in [`pr-self-review/references/routing.md`](../skills/pr-self-review/references/routing.md).
  Planner, implementer and `pr-self-review` all read it, so the plan, the code
  and the review follow the same rules. Change the mapping there, not in the agents.
- **Skills are loaded by explicit `Skill` calls**, not by the `skills:`
  frontmatter field (see sources below).
- **Parallel safety comes from the plan:** tasks in one wave never share a
  file; lockfiles, the DB schema + migration, `coupled-files.md` pairs and
  i18n message files are each owned by one task.
- Repo-wide rules (Zod 3, do-not-touch paths, English docs, staging by explicit
  path) come from the root `CLAUDE.md` and are not restated in the agents beyond
  what each one must enforce.

## Sources

The planner and implementer rules are based on these. Community sources are
marked; where we deliberately deviate, it is noted.

**Claude Code / Anthropic (official)**

- [Create custom subagents](https://code.claude.com/docs/en/sub-agents) —
  frontmatter fields, `description`-driven delegation, least-privilege `tools`,
  nested spawning (hence no `Agent` tool), `isolation: worktree`.
- [Extend Claude with skills](https://code.claude.com/docs/en/skills) — how
  subagents reach skills through the `Skill` tool.
- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) —
  explore → plan → code → verify, split between planner and implementer.
- [How and when to use subagents in Claude Code](https://claude.com/blog/subagents-in-claude-code) —
  a few well-scoped agents; parallel edits of one file conflict.
- [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (2025-06) —
  each subagent gets an objective, output format, tools and boundaries.
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) (2024-12) —
  orchestrator-workers: the main session orchestrates, implementers are workers.
- [anthropics/claude-code#67251](https://github.com/anthropics/claude-code/issues/67251) —
  reports that `skills:` frontmatter does not inject skill content; the reason
  both agents call `Skill` explicitly. Unverified on our installed version.

**Planning methods**

- [GitHub spec-kit](https://github.com/github/spec-kit) and
  [Handling complex features](https://github.github.com/spec-kit/concepts/complex-features.html) —
  contract-first ordering, task IDs `T001`, the `[P]` parallel marker, one task
  per sub-agent with focused context.
- [Kiro specs](https://kiro.dev/docs/specs/) — requirements → design → tasks,
  tasks traced back to requirements, a design section with data flow.
- [Cline Plan & Act](https://docs.cline.bot/core-workflows/plan-and-act) —
  planning is read-only; ask before acting on an ambiguous request.

**obra/superpowers skills (community)**

- [`writing-plans`](https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md) —
  exact file paths per task, test-first steps, task = smallest unit with its own
  test, plan self-review checklist.
- [`brainstorming`](https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md) —
  clarify before designing.
- [`subagent-driven-development`](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md) —
  one-task brief, status vocabulary `DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED`,
  a review gate after each task. **Deviation:** it forbids parallel
  implementers; we run them in parallel on one branch and rely on exclusive
  file ownership instead of worktrees.
- [`executing-plans`](https://github.com/obra/superpowers/blob/main/skills/executing-plans/SKILL.md) —
  no scope creep; a broken plan is escalated, not patched.
- [`test-driven-development`](https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md) —
  red → green → refactor, bounded here by `TESTING.md`.
- [`verification-before-completion`](https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md) —
  no completion claim without a fresh command run.

**Role-specialised agent collections (community)**

- [wshobson/agents](https://github.com/wshobson/agents),
  [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) —
  separate backend and frontend developer agents. **Deviation:** one
  implementer with two mandatory skill sets.

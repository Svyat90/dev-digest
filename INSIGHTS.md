# devdigest — cross-cutting insights

Traps that belong to no single package: `scripts/`, Docker, CI, contract drift
between server and client, the pnpm/npm split. Package-local traps go in
`<package>/INSIGHTS.md`. Newest first, one entry per trap.
Format: date · symptom · cause · rule.

Appended by the `engineering-insights` skill: append-only, never rewritten.

## What Works

Approaches and solutions that held up here.

## What Doesn't Work

Dead ends and antipatterns. The most frequently skipped section and the most
valuable one.

- **2026-10-03 — An unquoted vitest glob in a shell script silently shrinks the server suite.**
  `TESTS="--exclude **/*.it.test.ts"; vitest run $TESTS` lets macOS bash 3.2
  (no globstar) expand the pattern to `test/*.it.test.ts` file names; vitest
  takes them as positional filters and the "unit" run went green with 80 of
  243 tests — nothing failed, nothing warned.
  Rule: in `scripts/*.sh` that pass globs or file lists through a variable,
  `set -f` (as `scripts/verify-task.sh` does) or quote the glob; check the
  `Tests N passed` count against a direct run after any change to the command.
  `cd server && ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' --reporter=dot --silent` → `Tests 243 passed`

## Codebase Patterns

Conventions and structural decisions a newcomer would otherwise re-derive.

- **2026-10-03 — A plan's `Status:` line does not say whether it shipped.**
  `docs/plans/2026-09-25-intent-layer.md`, `2026-09-26-smart-diff.md` and
  `2026-09-30-blast-radius.md` still read `Status: draft` although their branches
  were merged (PRs #10, #12, #15); nobody moved them to `approved` / `done`.
  Anything keyed on that line misreads them as open — notably
  `.claude/hooks/implementation-planner-scope.mjs`, which lets the planner
  rewrite any `draft` plan.
  Rule: when a plan's branch merges, set its `Status: done` in the same PR; never
  treat `Status: draft` alone as proof that a plan is still in progress.
  `grep -m1 "Status:" docs/plans/2026-*.md`

- **2026-09-20 — "Which reviews does the PR-list FINDINGS column count?" is defined TWICE.**
  The server picks them for the chips (`pickLatestReviewIds`: each agent's newest
  `kind='review'` review, per PR), and the client re-derives the same set for the
  hover preview (`latestReviewPerAgent`) from `GET /pulls/:id/reviews`, because the
  list payload carries only counts. Change the rule on one side and nothing fails:
  the chips and the card just disagree, and `FindingsPreviewCard`'s "+N more"
  goes negative. `PRRow.test.tsx` mocks `usePrReviews`, so no test spans both.
  Rule: touch either function → change and test the other in the same commit.
  `server/src/modules/pulls/status.ts` (`pickLatestReviewIds`),
  `client/src/components/findings-preview/helpers.ts` (`latestReviewPerAgent`)

- **2026-09-19 — `diff -r` over the two `vendor/shared` copies is NOT a drift gate.**
  Root `CLAUDE.md` says the client copy "has already drifted", but not that the
  drift is permanent and load-bearing: `eval-ci.ts`, `knowledge.ts`,
  `productionize.ts` and `trace.ts` differ today (the server copy knows
  `openrouter`, `AgentManifest`, `AgentVersion`; the client copy does not). A
  whole-directory diff therefore always prints pages of noise, and a real
  divergence in the file you just edited is invisible inside it.
  Rule: after changing a contract, diff ONLY the files you touched —
  `for f in findings.ts platform.ts; do diff -q server/src/vendor/shared/contracts/$f client/src/vendor/shared/contracts/$f; done`
  — and expect that check to be silent.
  `server/src/vendor/shared/contracts/`, `client/src/vendor/shared/contracts/`

## Tool & Library Notes

Quirks of tooling shared across packages: Docker, pnpm/npm, CI.

- **2026-10-03 — Edits to an agent's frontmatter do not reach that agent until the session restarts.**
  Adding a `Bash` matcher and a `PostToolUse` hook to `.claude/agents/spec-creator.md`
  mid-session had no effect on the next run of that agent: `echo test > /tmp/…`
  was not blocked and the lint hook never fired. The changed hook *script*
  (read fresh on every call) did take effect, and the session's agent list still
  showed the file's first-version description.
  After a session restart the same run blocked the redirect ("spec-creator
  blocked: Bash is read-only for this agent") and returned the lint errors.
  Rule: after changing `tools:`, `hooks:` or `description` in `.claude/agents/*.md`,
  restart the session before testing the agent; changes inside a hook script do
  not need a restart.
  `.claude/agents/spec-creator.md` (frontmatter) · `.claude/hooks/spec-creator-scope.mjs`

- **2026-10-03 — A subagent cannot ask the user anything; only a hook's `ask` reaches the user.**
  Inside a subagent `AskUserQuestion` fails with "AskUserQuestion is not available
  inside subagents. Complete the task with the tools provided and return findings
  to the orchestrator." A PreToolUse hook declared in the agent's frontmatter that
  returns `permissionDecision: "ask"` does show the user a permission prompt, and
  an exit-2 denial returns its stderr text to the agent.
  Rule: design every agent in `.claude/agents/` to return its questions to the
  main session (which asks the user and re-runs it); use a frontmatter hook with
  `ask` only for a yes/no permission gate, never for an open question.
  `.claude/agents/spec-creator.md` · `.claude/hooks/spec-creator-scope.mjs`

- **2026-09-29 — `rg` (ripgrep) is not installed on the dev machine; gate commands written with it fail.**
  The MCP plan's verification gates used `rg -n …`; every implementer had to
  rewrite them by hand, and a gate that errors is easy to misread as "no output".
  Rule: write grep-based gates in plans, skills and docs as `grep -rnE`
  (`--exclude=<file>` instead of `--glob '!<file>'`); do not assume `rg` exists.
  `command -v rg` → no output · `docs/plans/2026-09-29-mcp-server.md` (mcp-gates)

- **2026-09-29 — The MCP TypeScript SDK v2 cannot be used here: it hard-depends on Zod 4.**
  `@modelcontextprotocol/server` 2.x (the v2 package name) lists `zod: ^4.2.0` as a
  regular dependency, and its migration guide states Zod 3 is no longer supported —
  a Zod-3 range installs and typechecks cleanly and fails only at runtime. The v1
  package `@modelcontextprotocol/sdk` (1.31.0) peers on `zod ^3.25 || ^4.0`, so it
  accepts the repo's pinned 3.25.
  Rule: any MCP server or client in this repo uses `@modelcontextprotocol/sdk` v1,
  never `@modelcontextprotocol/server`/`client` v2, while the "Zod 3, not 4" rule
  stands; after install, run `npm ls zod` and expect a single copy (two copies give
  TS2589 in v1).
  `npm view @modelcontextprotocol/server dependencies.zod` → `^4.2.0` ·
  `npm view @modelcontextprotocol/sdk peerDependencies` → `zod: '^3.25 || ^4.0'`

- **2026-09-26 — `./scripts/e2e.sh` leaves `client/next-env.d.ts` and `client/tsconfig.json` modified.**
  The hermetic stack runs `next dev` with the `.next-e2e` distDir, and Next rewrites
  both files on boot: `next-env.d.ts` references `./.next-e2e/types/routes.d.ts`, and
  `tsconfig.json` is re-serialized (arrays expanded, `.next-e2e/types/**/*.ts` added to
  `include`). Seen on every run in this session; `git status` shows ` M` for both.
  Rule: after an e2e run, `git restore client/next-env.d.ts client/tsconfig.json`
  before staging anything, and never commit either change.
  `scripts/e2e.sh`

- **2026-09-26 — `typecheck` in `server/` and `reviewer-core/` never type-checks `test/`, so "typecheck is green" says nothing about test files.**
  Both `tsconfig.json` files have `"include": ["src/**/*.ts"]`. Root `CLAUDE.md`
  asks for `pnpm typecheck && pnpm test` before "done", which reads as covering
  everything, but a type error in a test file only surfaces (or not) at vitest
  runtime, where esbuild strips types. Proof: `reviewer-core/test/run.test.ts:111`
  (`async completeStructured<T>(req)` in an object typed `LLMProvider`) has carried
  `TS7006: Parameter 'req' implicitly has an 'any' type` unnoticed while
  `npm run typecheck` printed nothing. `client/` and `e2e/` were not checked.
  Rule: after writing or editing tests, type-check them separately with a scratch
  tsconfig that `extends` the package one, keeps `src/**` and adds `test/**`, and
  sets `typeRoots` to the package's `node_modules/@types` (a tsconfig outside the
  package cannot find `@types/node` otherwise). Do not treat the stock
  `typecheck` as proof for tests.
  `server/tsconfig.json:28`, `reviewer-core/tsconfig.json:28` ·
  `npx tsc -p <scratch>/tsconfig.json` → `test/run.test.ts(111,35): error TS7006`

- **2026-09-21 — `server` typecheck fails inside `../reviewer-core` when reviewer-core has no `node_modules`.**
  `server/tsconfig.json` aliases `@devdigest/reviewer-core` to `../reviewer-core/src`,
  so `tsc` compiles those sources and resolves their imports from
  `reviewer-core/node_modules`. In a fresh worktree or clone with only
  `server/` installed, `pnpm run typecheck` prints
  `../reviewer-core/src/llm/structured.ts(1,19): error TS2307: Cannot find module 'zod'`
  (plus `openai`, `openai/helpers/zod`). That reads like a broken server change, but
  nothing in `server/` is wrong.
  Rule: before trusting a server typecheck in a new checkout, run `npm install` in
  `reviewer-core/` as well. `pr-self-review`'s precheck reports this case by name.
  `server/tsconfig.json:24-25`

- **2026-09-21 — The installed zod 3.25 exports `zod/v4`, so the "Zod 3, not 4" rule is not enforced by the compiler.**
  `zod@3.25.76` (server, client, reviewer-core) exports `./v4`, `./v4-mini`,
  `./v4/mini` and `./v4/core`. `import { z } from 'zod/v4'` resolves, so Zod 4 API
  written that way passes typecheck. Only Zod 4 calls on the v3 `z` (`z.email()`,
  `z.strictObject()`) fail to compile.
  Rule: treat any `zod/v4`, `zod/mini` or `@zod/*` import as a violation. The check is
  a grep (`pr-self-review` precheck `zod-3-only`), never a typecheck.
  `node -p "Object.keys(require('./server/node_modules/zod/package.json').exports)"`

- **2026-09-21 — The installed pnpm (12.4.2) rejects `-s`.**
  `pnpm -s arch:check` fails with `error: unexpected argument '-s' found` before
  running anything, which reads like a broken script rather than a CLI change.
  Rule: invoke package scripts as `pnpm run <script>` in commands, docs and CI;
  do not copy `pnpm -s` from older snippets.
  `pnpm --version` → 12.4.2

## Recurring Errors & Fixes

An error seen twice, plus the fix that actually worked.

## Session Notes

Dated summary, only when a session changed how the stack is worked on.

## Open Questions

What was left unresolved, so the next session does not re-investigate blind.

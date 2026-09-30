# mcp — insights

Traps found while working here. Newest first, one entry per trap.
Format: date · symptom · cause · rule.

Appended by the `engineering-insights` skill: append-only, never rewritten.

## What Works

Approaches and solutions that held up here.

## What Doesn't Work

Dead ends and antipatterns. The most frequently skipped section and the most
valuable one.

- **2026-09-29 — A test `Clock` with a fixed `now()` and a no-op `sleep` crashes the vitest worker with OOM, not a timeout.**
  `waitForRun` measures elapsed time only through `clock.now()`, so a clock that
  never advances never reaches the deadline, and a resolving `sleep` makes the
  poll loop spin synchronously. vitest printed `Error: Worker exited unexpectedly`
  with a `node::OOMErrorHandler` stack. It named no test and never hit the test timeout.
  Rule: in a test that can reach `waitForRun`, use `virtualClock(start)` from
  `test/helpers/harness.ts` (its `sleep` advances time); hand-roll a `Clock` only
  when its `sleep` blocks, like the cancellation test.
  `mcp/src/domain/wait.ts` (`waitForRun`), `mcp/test/helpers/harness.ts` (`virtualClock`)

## Codebase Patterns

Conventions and structural decisions a newcomer would otherwise re-derive.

## Tool & Library Notes

Quirks of the dependencies this package pins.

- **2026-09-29 — To prove a tool sends NO `notifications/progress`, override the client's progress handler.**
  A `callTool` without `onprogress` gives the test no hook: the SDK v1 client
  already owns a `notifications/progress` handler, so "the call succeeded" is all
  a naive test can assert — and it stays green when the tool emits progress with
  no token. Replacing that handler counts what actually arrives: a mutation that
  dropped the `progressToken === undefined` guard made the count 3, not 0.
  Rule: for a "no token → no progress" check, call
  `client.setNotificationHandler(ProgressNotificationSchema, () => count++)`
  (schema from `@modelcontextprotocol/sdk/types.js`) before the token-less call and
  assert `count === 0`.
  `mcp/test/run-agent-on-pr.test.ts` (progress test), `mcp/src/tools/run-agent-on-pr.ts:60`

## Recurring Errors & Fixes

An error seen twice, plus the fix that actually worked.

- **2026-09-30 — Any pnpm command in `mcp/` silently replaces the npm install.**
  `pnpm inspect` (no such script) still reinstalled deps, left untracked
  `pnpm-lock.yaml` + `pnpm-workspace.yaml`, rebuilt `node_modules` as a pnpm tree
  (`node_modules/.pnpm`) and exited with `ERR_PNPM_IGNORED_BUILDS` (esbuild).
  Rule: to recover, `rm -f pnpm-lock.yaml pnpm-workspace.yaml && rm -rf node_modules && npm ci`;
  never answer the `allowBuilds` prompt in `pnpm-workspace.yaml`. Launch the inspector with `npm run inspect`.
  `mcp/package.json` (`inspect` script)

## Session Notes

Dated summary, only when a session changed how this package is worked on.

## Open Questions

What was left unresolved, so the next session does not re-investigate blind.

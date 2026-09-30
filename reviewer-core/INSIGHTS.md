# reviewer-core — insights

Traps found while working here. Newest first, one entry per trap.
Format: date · symptom · cause · rule.

Appended by the `engineering-insights` skill: append-only, never rewritten.

## What Works

Approaches and solutions that held up here.

## What Doesn't Work

Dead ends and antipatterns. The most frequently skipped section and the most
valuable one.

## Codebase Patterns

Conventions and structural decisions a newcomer would otherwise re-derive.

## Tool & Library Notes

Quirks of the dependencies this package pins.

- **2026-09-29 — The OpenAI SDK `timeout` stops at headers; a stalled OpenRouter call hangs forever.**
  openai 4.104 clears its timer once `fetch` resolves (`node_modules/openai/core.js`
  `fetchWithTimeout` → `.finally(clearTimeout)`), and OpenRouter answers non-streaming
  calls with `200` headers at once, then keep-alive padding while the upstream
  generates. A stalled upstream left a review run `running` for 25+ min with no
  error, no retry and no generation on the OpenRouter dashboard.
  Rule: every `chat.completions.create` call MUST go through `createWithDeadline`
  (an `AbortSignal.timeout` passed as a request option, which also aborts the body
  read) — never rely on the constructor's `timeout` alone.
  `src/llm/openrouter.ts:131`, reproduced by `test/openrouter.test.ts`

## Recurring Errors & Fixes

An error seen twice, plus the fix that actually worked.

## Session Notes

Dated summary, only when a session changed how this package is worked on.

## Open Questions

What was left unresolved, so the next session does not re-investigate blind.

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

## Codebase Patterns

Conventions and structural decisions a newcomer would otherwise re-derive.

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

## Recurring Errors & Fixes

An error seen twice, plus the fix that actually worked.

## Session Notes

Dated summary, only when a session changed how the stack is worked on.

## Open Questions

What was left unresolved, so the next session does not re-investigate blind.

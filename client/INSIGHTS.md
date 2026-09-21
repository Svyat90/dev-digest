# client — insights

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

- **2026-09-19 — A missing number renders as an em dash, never as `$0.00`.**
  Cost is absent for runs on unpriced models and for failed runs; `$0.00` would
  claim the run was free, which some models genuinely are. `formatUsd` encodes
  this: `null`/`undefined` → `"—"`, exact `0` → `"$0"`.
  Rule: route every USD value through `formatUsd` (and token counts through
  `formatTokenCount`) rather than formatting inline — the three cost surfaces
  (PR row, run timeline, trace drawer) live in different subtrees and drifted
  formatters is exactly how they stop matching.
  `client/src/lib/format.ts`, `client/src/lib/format.test.ts`

## Tool & Library Notes

Quirks of the dependencies this package pins.

- **2026-09-19 — `toFixed` rounds money the wrong way; `Intl` silently drops `minimumFractionDigits`.**
  `(0.0135).toFixed(3)` is `"0.013"` (0.0135 is stored as 0.013499…), so a cost
  would read a tenth of a cent low. `Intl.NumberFormat` fixes that, but once
  `maximumSignificantDigits` is set it IGNORES `minimumFractionDigits`, turning
  12.345 into `"$12"` and 0.5 into `"$0.5"` — both verified in node.
  Rule: scale-then-round (`Math.round(v * 10**d) / 10**d`) before `toFixed`, and
  do NOT swap `formatUsd` for `Intl.NumberFormat`.
  `client/src/lib/format.ts`

## Recurring Errors & Fixes

An error seen twice, plus the fix that actually worked.

## Session Notes

Dated summary, only when a session changed how this package is worked on.

## Open Questions

What was left unresolved, so the next session does not re-investigate blind.

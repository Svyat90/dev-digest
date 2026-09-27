# e2e — insights

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

- **2026-09-26 — A `find` step with no action verb CLICKS the element; it is not a presence check.**
  `agent-browser find <locator> <value> [action]` defaults the action to `click`
  (`agent-browser find --help` → "Actions (default: click)"). Flow 08's
  `["find","role","button","--name","Collapse Boilerplate group"]` failed on the
  hermetic run instead of asserting the button exists.
  Rule: to assert an element exists without touching it, pass the `text` action —
  `["find","role","button","text","--name","…"]` — which reads and fails when absent.
  `e2e/specs/08-smart-diff.flow.json:21-22`

- **2026-09-26 — `wait --text` matches the RENDERED text, after CSS `text-transform`.**
  The Smart Diff header string is "Reviewer-ordered diff" in `prReview.json`, but its
  style has `textTransform: "uppercase"`, and `agent-browser wait --text "Reviewer-ordered diff"`
  timed out on the hermetic stack; `wait --text "REVIEWER-ORDERED DIFF"` passes.
  Rule: before asserting a label in a flow, check its style for `textTransform` and
  write the text as the browser displays it, not as the i18n file spells it.
  `client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/DiffTab/styles.ts:8-14`, `e2e/specs/08-smart-diff.flow.json:12`

## Recurring Errors & Fixes

An error seen twice, plus the fix that actually worked.

## Session Notes

Dated summary, only when a session changed how this package is worked on.

## Open Questions

What was left unresolved, so the next session does not re-investigate blind.

- **2026-09-26 — Flow 02 fails at `wait --text Findings` on a clean hermetic run, before Smart Diff too.**
  `./scripts/e2e.sh` on `feature/l03-intent-layer` gives 6/7 with
  "✗ the FINDINGS column header is present on the list — Command failed: agent-browser wait --text Findings";
  `feature/l03-smart-diff` fails the same step. Not investigated. The step label spells
  the header in capitals, so a CSS uppercase header (see the `wait --text` entry
  above) is the first suspect — unconfirmed.
  `e2e/specs/02-repo-pulls-detail.flow.json:8`
  Confidence: low

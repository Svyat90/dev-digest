# e2e — insights

Traps found while working here. Newest first, one entry per trap.
Format: date · symptom · cause · rule.

Appended by the `engineering-insights` skill: append-only, never rewritten.

## What Works

Approaches and solutions that held up here.

## What Doesn't Work

Dead ends and antipatterns. The most frequently skipped section and the most
valuable one.

- **2026-09-30 — A green `./scripts/e2e.sh` does not mean CI will pass: it runs `next dev`, CI runs a production build.**
  Against `next build && next start` the PR list renders faster than the data, so
  `find text "<PR title>" click` straight after `wait --url /pulls` fires while the page
  still shows "Loading pull requests…" and fails with
  "Command failed: agent-browser find text Add rate limiting to public API endpoints click".
  Under `next dev` the same flows pass.
  Rule: before any `find … click` on data-driven content, add a `wait --text` for that
  content; to reproduce CI locally, run a copy of `scripts/e2e.sh` with
  `next build && NEXT_DIST_DIR=.next-e2e next start -p "$WEB_PORT"` in place of `next dev`.
  `e2e/specs/04-pr-findings.flow.json:7`, `.github/workflows/e2e-web.yml` (Build + start web)

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

- **2026-09-30 — Resolved (supersedes the 2026-09-26 flow 02 entry below): the FINDINGS header is CSS-uppercased.**
  `headRow` sets `textTransform: "uppercase"`, so the rendered header is "FINDINGS";
  flow 02 now waits for `FINDINGS` and passes (8/8 in dev and prod mode).
  `client/src/app/(shell)/repos/[repoId]/pulls/styles.ts:115`, `e2e/specs/02-repo-pulls-detail.flow.json:8`

- **2026-09-26 — Flow 02 fails at `wait --text Findings` on a clean hermetic run, before Smart Diff too.**
  `./scripts/e2e.sh` on `feature/l03-intent-layer` gives 6/7 with
  "✗ the FINDINGS column header is present on the list — Command failed: agent-browser wait --text Findings";
  `feature/l03-smart-diff` fails the same step. Not investigated. The step label spells
  the header in capitals, so a CSS uppercase header (see the `wait --text` entry
  above) is the first suspect — unconfirmed.
  `e2e/specs/02-repo-pulls-detail.flow.json:8`
  Confidence: low

# spec — smart diff

Smart Diff orders a PR's **Files changed** tab the way a reviewer should read
it — core → tests → wiring → docs → boilerplate — and rolls each agent's open
findings up onto the files and lines that carry them. Grouping is a
deterministic path classifier: it makes no model call and works before the
first review runs. This is the canonical spec: the invariants below are
behaviour the client and the e2e suite already depend on, so changing one is a
breaking change, not a refactor.

Architecture context: [`../docs/architecture.md`](../docs/architecture.md).
The findings-per-agent rule this feature reuses (never redefines):
[`review-flow.md`](review-flow.md) › *Derived reads* ›
`findings_by_severity`.

## Invariants

| # | Rule |
|---|---|
| SD1 | A file's role is decided by `classifyFile(path)` (`src/modules/smart-diff/classify.ts:9`) against `ROLE_RULES` (`src/modules/smart-diff/constants.ts:28`), in **precedence** order `boilerplate → tests → wiring → docs`; the first matching rule wins. `core` is the fallback when none matches. |
| SD2 | Three precedence outcomes are contested — more than one rule could plausibly claim the path — and are pinned by name in `test/smart-diff-classify.test.ts`, not left to a comment alone: (a) a snapshot under a `__tests__/__snapshots__/` segment is `boilerplate`, because boilerplate is checked before tests; (b) `e2e/README.md` is `tests`, not `docs`, because its path starts with `e2e/` and tests is checked before docs; (c) a `.md` file under `.claude/**` (e.g. `.claude/skills/security/SKILL.md`) is `wiring`, not `docs`, because wiring is checked before docs. |
| SD3 | The boilerplate `dist/`/`build/` rule is **root-anchored** (`^dist/`, `^build/`): `dist/app.js` is `boilerplate`, but a non-root occurrence such as `client/dist/app.js` falls through to `core`. This is intentional, recorded in the classify table test, and is not "fixed" by widening the regex. |
| SD4 | `package.json` is in no rule's pattern list, so it always classifies as `core` — on purpose, so a dependency bump reads as a substance change, not boilerplate. |
| SD5 | `ROLE_ORDER` (`core, tests, wiring, docs, boilerplate`, `constants.ts:9`) is the **display** order and is a separate concern from precedence: `buildSmartDiff` (`helpers.ts:52`) emits one group per role in this order and **omits a role with no files** — a PR with only core and docs files returns exactly two groups. |
| SD6 | Within a group, files keep the order the PR's files were read from GitHub: `SmartDiffRepository.listFiles` selects `pr_files` with the same unordered `select` `pulls/routes.ts` uses (`repository.ts:54`), and `buildSmartDiff` buckets files into their role in that same input order, appending, never re-sorting. |
| SD7 | `finding_lines` for a file is the sorted, unique set of `start_line` values (`helpers.ts:29-39`, `58`) from findings that are (a) non-dismissed (`dismissedAt === null`) — an *accepted* finding still counts, only a *dismissed* one is excluded — and (b) anchored to that file (`anchors.file === path`). The anchors themselves come from **each agent's latest `kind='review'` review only**: `SmartDiffService.get` (`service.ts:33`) calls `pickLatestReviewIds` (`src/domain/reviews/latest-review.ts:11`) over review heads ordered newest-first (`repository.ts:69-81`) — the same selection rule `findings_by_severity` uses (`review-flow.md`), reused verbatim, never redefined for this feature. |
| SD8 | `split_suggestion` is always `{too_big: false, total_lines: Σ(additions + deletions) over every file in the PR, proposed_splits: []}` (`helpers.ts:62-66`) — there is no real split-detection logic in this feature. `pseudocode_summary` stays a `nullish` field on the contract (`vendor/shared/contracts/brief.ts:86`) and the route simply never sets it. |
| SD9 | `GET /pulls/:id/smart-diff` never reaches a model or GitHub. `modules/smart-diff/**` imports no `LLMProvider`, no `reviewer-core`, no `Container` — `SmartDiffService` takes a narrow `SmartDiffDeps { repo }` (`service.ts:12`) — and the response is available before any review has run (an unreviewed PR still returns all its groups, with every `finding_lines` empty). `test/smart-diff.it.test.ts` builds the app with a THROWING double for every LLM provider and for GitHub, so an accidental call fails the request instead of quietly succeeding. |
| SD10 | `classifyFile` is pure: it imports only `./constants.js` and the `SmartDiffRole` type from `@devdigest/shared` (`classify.ts:1-2`) — no HTTP, no DB, no Fastify, no Drizzle. It is a plain `path -> role` function, reusable by anything that only needs the classification (a later lesson's tooling included) without pulling in the route, service or repository. |
| SD11 | Tenancy: `getPull` scopes on `pull_requests.workspace_id` and 404s a PR outside the caller's workspace (`repository.ts:40-46`, `service.ts:26`) before any other read runs. `findings` carries no `workspace_id` of its own (server `INSIGHTS.md`, "the ONE domain table with no `workspace_id`"), so `listFindingAnchors` reaches tenancy only through an `innerJoin` on `reviews` (`repository.ts:88-99`) — never by filtering on the PR id alone. `IdParams` rejects a non-UUID `id` with 422 before the handler runs. |

## Data model

No schema change and no migration — this feature only reads existing tables
(`pull_requests`, `pr_files`, `reviews`, `findings`). `server/src/db/seed.ts`
gained four extra `pr_files` rows on PR #482, one per non-core role, so a
fresh database exercises all five groups before any review runs (see
`e2e/docs/coverage-spec.md`).

**Contract** (`SmartDiffRole`, `SmartDiffFile`, `SmartDiffGroup`, `SmartDiff` —
`vendor/shared/contracts/brief.ts:81-113`, both `vendor/shared` copies
identical for this file, root `INSIGHTS.md` "diff only the touched file"):

```ts
SmartDiffRole = 'core' | 'tests' | 'wiring' | 'docs' | 'boilerplate'
SmartDiffFile = { path, pseudocode_summary?, additions, deletions, finding_lines: number[] }
SmartDiffGroup = { role: SmartDiffRole, files: SmartDiffFile[] }
SmartDiff = { groups: SmartDiffGroup[], split_suggestion: { too_big, total_lines, proposed_splits: [] } }
```

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/pulls/:id/smart-diff` | Returns `SmartDiff` (SD1–SD8), validated by the response schema. 404 outside the workspace (SD11), 422 for a non-UUID `id`. |

## Module layout (onion, per `arch:check`)

`server/src/modules/smart-diff/`:

- `constants.ts` — `ROLE_ORDER` (display) and `ROLE_RULES` (precedence), regexes only, no dependency (SD1–SD4).
- `classify.ts` — `classifyFile(path)`, pure (SD10).
- `helpers.ts` — `buildSmartDiff(files, anchors)`, pure grouping + `finding_lines` + `split_suggestion` (SD5–SD8); declares local `SmartDiffFileInput` / `FindingAnchorInput` structural types instead of importing them from `repository.ts`, the same `no-circular` avoidance as `conventions/helpers.ts` (server `INSIGHTS.md`, 2026-09-22).
- `repository.ts` — all Drizzle access: `getPull`, `listFiles`, `listReviewHeads`, `listFindingAnchors` (SD6, SD11).
- `service.ts` — `SmartDiffService.get`: read → pure decision → read → pure decision, narrow `SmartDiffDeps`, no `Container` (SD9).
- `routes.ts` — the one endpoint above, registered in `modules/index.ts`.

`pickLatestReviewIds` itself lives in `src/domain/reviews/latest-review.ts`,
shared with `modules/pulls/routes.ts`'s FINDINGS rollup — it is a move from
its previous home in `modules/pulls/status.ts`, not a new definition (root
`INSIGHTS.md`, "defined TWICE").

## Client

The client derives everything Smart Diff shows from the **same** two query
results, so nothing can disagree mid-refetch:

- `useSmartDiff(prId)` (`client/src/lib/hooks/smart-diff.ts`) supplies role
  groups and order; `usePrReviews(prId)` supplies reviews, filtered to
  `kind === 'review'` and reduced with `latestReviewPerAgent` (the client twin
  of `pickLatestReviewIds`) to get the same "latest per agent" findings set
  SD7 describes server-side. `DiffTab/helpers.ts`'s `buildRoleGroups` and
  `latestFindings` do this derivation; a file path missing from the
  `smart-diff` response (a refresh race) falls back to `core` rather than
  being dropped.
- The group counter ("● N"), the file-card red dot and the inline finding
  cards all read from that one findings list — Accept/Dismiss invalidates
  `keys.reviews` and `keys.smartDiff` together (`useInvalidateReviewResults`,
  `client/src/lib/hooks/reviews.ts`).
- One `showComments` toggle (default: `null`, meaning "shown once the PR has
  an open finding, hidden otherwise") gates GitHub comment threads, inline
  finding cards, the line severity bar/label and the off-patch block at once;
  the file dot and the group counter are never hidden by it.
- The shared finding card moved to `client/src/components/finding-card`
  (`FindingCard`) once the diff viewer became its second consumer; it is used
  both by the Agent runs tab and, here, by `InlineFindings` /
  `OffPatchFindings`.
- The header's file count is `files.length` over the files actually passed to
  `DiffTab` (`DiffTab/helpers.ts`'s `diffTotals`), not the PR's stored
  `files_count` — the two can differ if `pr_files` and the PR row's counter
  ever drift.
- The Smart Diff role-group header is `position: sticky` at
  `top: var(--pr-header-h, 0px)`, where `--pr-header-h` is `PrDetailHeader`'s
  *measured* rendered height (`PrDetailHeader/useHeaderHeightVar.ts`), so a
  wrapped PR title that grows the page header never gets covered by the
  group header sticking at a hard-coded offset.

See [`../../client/docs/ui-architecture.md`](../../client/docs/ui-architecture.md)
› Cache keys for the `["smart-diff", prId]` query key.

## Tests that pin these invariants

| Level | File | Covers |
|---|---|---|
| unit | `test/smart-diff-classify.test.ts` | SD1–SD4: the full path → role table, including the three contested cases and the root-anchored `dist/`/`build/` exception |
| unit | `test/smart-diff-helpers.test.ts` | SD5–SD8: `ROLE_ORDER` grouping, input-order preservation, empty-group omission, `finding_lines` dedupe/sort/dismissed-filtering, `total_lines` |
| integration | `test/smart-diff.it.test.ts` | SD7, SD9, SD11: pre-review response with a throwing LLM/GitHub double, latest-per-agent + dismissed findings against real Postgres, empty-group omission, tenancy 404, id-validation 422 |
| client unit | `client/src/components/diff-viewer/findings.test.ts` | the client's `partitionFindings`/`topSeverity` twin of SD7's line anchoring |
| client unit | `.../DiffTab/helpers.test.ts` | the client's `buildRoleGroups`/`latestFindings` twin of SD5–SD7 |
| client unit | `.../FileCard/FileCard.test.tsx`, `.../DiffTab/DiffTab.test.tsx` | the dot, severity bar/label, toggle and empty-state behaviour described under Client |
| e2e | `e2e/specs/08-smart-diff.flow.json` | all five groups render with labels/descriptions, Docs/Boilerplate start collapsed, the order toggle round-trips (read-only, no model) |

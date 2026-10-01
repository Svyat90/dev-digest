# spec — blast radius

Blast Radius answers the reviewer's question the diff cannot: *what else in the
repository can this change break?* For every symbol declared in a PR's changed
files it shows who calls it (`file:line`, linked to GitHub) and which HTTP
endpoints and crons sit in those callers' files. It is a **read** feature: the
data was computed by `repo-intel` when the repository was cloned/indexed. The
route reads that index once, regroups it, and returns it — it makes no model
call and does not parse the repository again.

Two consumers read the same route: the **Blast radius** card on the PR
Overview tab (client) and the `get_blast_radius` tool of `devdigest-mcp`, so
Claude Code sees exactly what the browser shows.

This is a **pre-implementation spec** for the L04 homework. It is the input
the `planner` turns into `docs/plans/`, and the yardstick `plan-verifier`
checks against. Scope: P1 + P2 acceptance criteria + the P3 items collapsible tree, crons
apart from endpoints, rank order, resync button, i18n **and Prior PRs**
(separate route, see *Prior PRs*). Graph view is out of scope (see the end).

Context: [`../src/modules/repo-intel/README.md`](../src/modules/repo-intel/README.md)
(the facade), [`smart-diff.md`](smart-diff.md) (the nearest precedent: a
deterministic PR-scoped read module with a client card).

## Invariants

| # | Rule |
|---|---|
| BR1 | `GET /pulls/:id/blast` calls `repoIntel.getBlastRadius(repoId, changedFiles)` **exactly once** per request, plus one `repoIntel.getIndexState(repoId)`. `changedFiles` = every `pr_files.path` of the PR. Nothing in `modules/blast/**` imports an `LLMProvider`, `reviewer-core`, the astgrep / codeindex adapters or the repo-intel pipeline. |
| BR2 | **Mapping.** `downstream` is the facade's flat `callers` list grouped by `viaSymbol`: one `DownstreamImpact` per changed symbol that has ≥1 caller, `callers[i] = { name: caller.symbol, file: caller.file, line: caller.line }`. The mapping is a pure function in `modules/blast/helpers.ts` (`toBlastRadius`), unit-tested. |
| BR3 | **Self-file exclusion.** A caller whose `file` is a file in which `viaSymbol` is declared (per `changedSymbols`) is dropped. The facade's fallback path already skips it; its persistent path does not, so the helper enforces it for both. |
| BR4 | **Endpoints / crons per symbol.** A group's `endpoints_affected` / `crons_affected` = the de-duplicated union of `factsByFile[file].endpoints` / `.crons` over that group's caller files, in first-seen order. When `factsByFile` is absent (fallback path) both are `[]` — never re-derived by reading files. |
| BR5 | **Order.** Callers inside a group keep the facade's order (rank DESC). Groups are ordered by their highest caller `rank` DESC, ties by symbol name. `changed_symbols` keeps the facade's order. |
| BR6 | **Limits come from `repo-intel/constants.ts`.** The per-symbol cap is `MAX_CALLERS_PER_SYMBOL`, applied **in the facade per `viaSymbol`** (see *Facade fix*), and echoed to the client as `limits.max_callers_per_symbol`. No numeric limit is written in `modules/blast/**`, the client or the MCP tool. Blast lists **direct** callers only; `BFS_DEPTH` is used by `getCriticalPaths`, not by blast — the spec records this so nobody "adds" a depth-2 walk to the route. |
| BR7 | **`summary`** is a deterministic English string built from numbers, e.g. `2 symbols · 14 callers · 3 endpoints · 1 cron`, where callers = Σ group sizes and endpoints / crons = unique counts across all groups. No model call, no optional LLM summary in v1. |
| BR8 | **Honest degradation.** The response carries `degraded` + `reason` + `index_status`. If the facade returned `degraded: true`, its `reason` is passed through unchanged. Else, if `getIndexState().status === 'partial'`, the response is `degraded: true, reason: 'index_partial'` and still carries the data. The server never swallows degradation into an empty-but-healthy map. |
| BR9 | **Never 500 on missing data.** The facade does not throw; an unindexed repo, a PR with no supported files, or a symbol with no callers all return 200 with empty arrays and the right `degraded`/`reason`. |
| BR10 | **Tenancy.** The PR is looked up scoped to `pull_requests.workspace_id`; outside the caller's workspace → 404 `NotFoundError` before the facade is touched. `IdParams` rejects a non-UUID id with 422. |
| BR11 | **Contract-validated.** The route declares `response: { 200: BlastRadiusResponse }`, so the zod serializer validates every response. |
| BR12 | **Observability (P2).** The service logs one `info` line per request: `{ prId, repoId, source: 'index' \| 'fallback', indexStatus, symbols, callers, durationMs }`, `msg: 'blast radius read'`. `source` is `'index'` when the facade returned `factsByFile` (persistent read, no parsing) and `'fallback'` otherwise. This is the log line the demo points at to prove no re-parse. |
| BR13 | **Links point at the indexed commit.** Caller lines come from the index, built at `lastIndexedSha`, which is generally not the PR head. The response exposes `index_sha`; the client builds `githubBlobUrl(repoFullName, index_sha ?? headSha, file, line)`. Caller files are outside the PR diff, so the link goes to GitHub, never into the Files-changed tab. |

## Facade fix (repo-intel)

`RepoIntelService.tryPersistentBlast` (`service.ts`, end of the method)
does `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` on the **whole** list after a
global rank sort, so one hot symbol can starve all the others, contradicting
the constant's own JSDoc ("Caller fan-out cap per changed symbol"). Fix in
place: after the rank sort, keep at most `MAX_CALLERS_PER_SYMBOL` rows **per
`viaSymbol`** (stable, preserves rank order). `impactedEndpoints` /
`factsByFile` stay computed over the kept callers' files. This is the only
facade change; the fallback path is untouched. Pinned by a unit test next to
`test/repo-intel-facade-degraded.test.ts`.

## Prior PRs (P3)

"Prior PRs touching these files": merged PRs that changed any of this PR's
files, newest first. It is a **separate** route so the blast route stays a
network-free index read (BR1, BR12); a GitHub failure here never affects the
blast map.

| # | Rule |
|---|---|
| PH1 | `GET /pulls/:id/history` returns `PrHistoryResponse` (below). Same tenancy / 404 / 422 rules as BR10, contract-validated as BR11. No model call. |
| PH2 | **Commits come from the local clone, not GitHub:** `git.log(repo, path)` per changed file (`GitClient.log`, `adapters/git/simple-git.ts`), at most `HISTORY_MAX_FILES` files (largest `additions + deletions` first) and `HISTORY_COMMITS_PER_FILE` newest commits per file. |
| PH3 | **PRs come from GitHub:** a new `GitHubClient.listPullsForCommit(repo, sha)` port method (`vendor/shared/adapters.ts`, both copies if the client copy carries the interface) implemented in `adapters/github/octokit.ts` with `repos.listPullRequestsAssociatedWithCommit`. At most `HISTORY_MAX_COMMIT_LOOKUPS` lookups per request, distinct shas newest first, run with bounded concurrency. |
| PH4 | Keep only **merged** PRs, drop the current PR's own number, de-duplicate by number, sort by `merged_at` DESC, cap at `HISTORY_MAX_ITEMS`. `files_overlap` = the changed files whose commits led to that PR (sorted). `notes` is deterministic text, e.g. `touched 2 of these files`. |
| PH5 | **Honest degradation:** no clone, no GitHub token, or a GitHub error → 200 with `history: []`, `degraded: true`, `reason: 'no_clone' \| 'github_unavailable'`. A single failed commit lookup is skipped; the response is `degraded: true, reason: 'partial'` only if some lookups failed and others succeeded. |
| PH6 | All four caps live in `modules/blast/constants.ts`; nothing else hard-codes them. |
| PH7 | Lives in the same `modules/blast/` module (`history.service.ts` or a second method on the service, planner's call) with narrow deps `{ git: Pick<GitClient,'log'>, github: () => Promise<Pick<GitHubClient,'listPullsForCommit'>> }`. The pure merge/sort/cap step is a helper with a unit test; the route test uses mocked git + GitHub doubles. |

Contract, next to `BlastRadiusResponse` in `review-api.ts` (both copies):

```ts
export const PrHistoryResponse = PrHistory.extend({
  degraded: z.boolean(),
  reason: z.enum(['no_clone', 'github_unavailable', 'partial']).nullable(),
});
```

Client: `usePrHistory(prId)` hook (`keys.prHistory`), and a collapsible
**Prior PRs touching these files** footer inside `BlastRadiusCard` with the
count badge; collapsed by default and fetched only when first expanded
(`enabled` gated on open). Each row: `#number` linked with `githubPrUrl`,
title, author, merged date, overlap files. Empty / degraded text from
`blast.json` (`history.*` keys). The MCP tool does **not** call this route
(keeps `get_blast_radius` index-only and cheap).

## Contract

`BlastRadius`, `DownstreamImpact`, `BlastCaller`, `ChangedSymbol` in
`vendor/shared/contracts/brief.ts` stay **unchanged** — `PrBrief` composes
`BlastRadius` and other lessons depend on it. The route returns a response
type added to `vendor/shared/contracts/review-api.ts` next to
`SmartDiffResponse`, in **both** copies (server canonical, client copy; today
both copies of `brief.ts` and `review-api.ts` are identical — after the edit,
`diff -q` on exactly these two files must stay silent):

```ts
export const BlastDegradedReason = z.enum([
  'flag_off', 'index_failed', 'index_partial', 'repo_too_large', 'no_data',
]);
export const BlastIndexStatus = z.enum(['full', 'partial', 'degraded', 'failed']);

export const BlastRadiusResponse = BlastRadius.extend({
  degraded: z.boolean(),
  reason: BlastDegradedReason.nullable(),   // null when degraded === false
  index_status: BlastIndexStatus,
  index_sha: z.string().nullable(),         // lastIndexedSha; null when never indexed
  limits: z.object({ max_callers_per_symbol: z.number().int() }),
});
```

No DB schema change, no migration.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/pulls/:id/blast` | `BlastRadiusResponse` (BR1–BR13). 404 outside the workspace, 422 for a non-UUID id. |
| GET | `/pulls/:id/history` | `PrHistoryResponse` (PH1–PH7). Same 404 / 422. |

Reused, unchanged: `GET /repos/:id/index-state`, `POST /repos/:id/resync`.

## Server module layout (onion, per `arch:check`)

`server/src/modules/blast/`, registered as `blast` in `modules/index.ts`:

- `routes.ts` — the Fastify plugin; builds the service from
  `{ repo: new BlastRepository(container.db), repoIntel: container.repoIntel, logger: app.log }`.
- `service.ts` — `BlastService.get(workspaceId, prId)`: getPull → listChangedPaths
  → facade (BR1) → `toBlastRadius` → log (BR12). Narrow deps only:
  `repoIntel: Pick<RepoIntel, 'getBlastRadius' | 'getIndexState'>` (type-only
  import of `repo-intel/types.ts`), never `Container` and never
  `RepoIntelService` (server INSIGHTS 2026-09-22: a container facade for
  another module's service is a `no-circular` violation).
- `repository.ts` — `getPull(workspaceId, prId) → { id, repoId } | undefined`,
  `listChangedPaths(prId) → string[]`. Owns no table.
- `helpers.ts` — pure `toBlastRadius(result: BlastResult, state, limits)`
  (BR2–BR8, BR13). Declares any row shape it needs locally rather than
  importing the repository's types (server INSIGHTS 2026-09-22, `no-circular`).

`pnpm arch:check` must stay green without re-baselining.

## Client

- **Hook** `useBlastRadius(prId)` in `client/src/lib/hooks/blast.ts`, key
  `keys.blast(prId)`, re-exported from `hooks/index.ts`. Mirrors `useIntent`.
- **Card** `OverviewTab/_components/BlastRadiusCard/` (`BlastRadiusCard.tsx`,
  `helpers.ts`, `styles.ts`, `index.ts`, test). `OverviewTab` gains a
  `repoFullName` prop, passed from `PrDetailView` (already has it). Layout per
  the design: Intent and Blast radius side by side, PR description below.
- **Summary row** (P1): symbols · callers · endpoints · crons, counted from the
  response with the BR7 rules, labels from `blast.json` (`stat.*`).
- **Tree** (P1 + P3): one collapsible row per `downstream` group — symbol name,
  `callerCount`; expanded body = callers as `file:line` links (BR13, open in a
  new tab), then endpoint chips, then cron chips **visually distinct** from
  endpoints. First group expanded by default, the rest collapsed.
- **States** (P1): loading skeleton; error line; **no callers** → the
  `noDownstream` message with the changed-symbol count (never an empty card);
  **degraded** → a badge with a human sentence per `reason`, shown above
  whatever data there is, plus a **Resync index** button (P3) wired to the
  existing `useResyncRepoIntel(repoId)` that also invalidates `keys.blast`.
- **i18n** (P3): every visible string comes from `messages/en/blast.json`
  (imported in tests as `@messages/en/blast.json`). New keys: `title`,
  `degraded.badge`, `degraded.reason.<reason>`, `resync`, `error`, `limitHint`.
  The unused `view.*` / `graph.*` keys stay for the out-of-scope Graph view.

## MCP — `get_blast_radius`

Replace the stub in `mcp/src/tools/get-blast-radius.ts`:

- Input unchanged: `{ repo: "owner/name", pr_number }`.
- `resolveRepoAndPull` → `pull === null` → `ToolFailure` `pr_not_found`
  (same wording as `get_findings`) → `api.blast(pull.id)` →
  `GET /pulls/:id/blast`, parsed by a local `BlastRadiusLite` schema in
  `mcp/src/api/schemas.ts` with a `// canonical:` comment like its neighbours.
- Output (`ok`): `{ repo, pr_number, summary, degraded, reason, index_status,
  downstream: [{ symbol, callers: ["file:line (name)"], endpoints, crons }] }`
  — the same groups and counts as the card, compacted; no new computation.
- Description: one sentence on what it returns + when to call it ("before
  reviewing a PR, to see which callers, endpoints and crons the change can
  break; reads a precomputed index, no LLM cost"). `title` drops "(not
  implemented)". `annotations: { readOnlyHint: true }` kept.
- Errors go through `toToolError` like the other tools.
- `mcp/README.md` tool table and the stub mentions are updated.
- Run only `npm` in `mcp/` (mcp INSIGHTS 2026-09-30: any pnpm command there
  replaces the npm install).

## Tests (typological, per TESTING.md)

| Where | What |
|---|---|
| `server/test/blast-helpers.test.ts` | `toBlastRadius`: grouping by `viaSymbol` (happy path), self-file exclusion (BR3), per-symbol endpoints/crons from `factsByFile` and `[]` without it (BR4), group order by rank (BR5), degraded pass-through and `index_partial` (BR8). |
| `server/test/repo-intel-*.test.ts` | Facade fix: two symbols, one with > `MAX_CALLERS_PER_SYMBOL` callers — the other keeps its callers. |
| `server/test/blast.it.test.ts` | Route: 200 validated by `BlastRadiusResponse`, 404 other workspace, 422 bad id, app built with a throwing LLM double (BR1). |
| `client/…/BlastRadiusCard.test.tsx` | Renders a group with a `file:line` link whose `href` is the blob URL at `index_sha`; the no-callers message; the degraded badge. |
| `mcp/test/tools-readonly.test.ts`, `mcp/test/server.test.ts` | Replace the stub assertions: happy path calls `/pulls/:id/blast` and returns the compact map; unknown PR → `pr_not_found`; `readOnlyHint: true`. |

Gate per package: `pnpm typecheck && pnpm test` (server, client),
`pnpm arch:check` (server), `npm run typecheck && npm test` (mcp).

## Acceptance criteria → where

| Criterion | Covered by |
|---|---|
| P1 Blast radius card on Overview | Client › Card |
| P1 summary: symbols, callers, endpoints, crons | BR7, Client › Summary row |
| P1 callers as `file:line`, endpoints below | BR2, BR4, Client › Tree |
| P1 test PR shows ≥2 real callers + ≥1 endpoint | Demo › test PR |
| P1 `file:line` opens that line on GitHub | BR13 |
| P1 clear empty state / partial-index badge with reason | BR8, Client › States |
| P1 working `get_blast_radius`, same map as the page | MCP |
| P2 log shows index read, no re-parse | BR1, BR12 |
| P2 response validated by the contract | BR11 |
| P2 mapping unit-tested | Tests › blast-helpers |
| P2 no LLM in the main path | BR1, BR7 |
| P2 declaring file not among its callers | BR3 |
| P2 limits from `constants.ts` | BR6, Facade fix |
| P2 `degraded` + `reason` reach the UI | BR8, Contract |
| P2 MCP tool per the lab rules | MCP |
| P3 collapsible tree, crons apart, rank order, resync button, i18n | BR5, Client |
| P3 Prior PRs touching these files | PH1–PH7 |

## Demo and verification

- **Index ready:** `curl http://localhost:3001/repos/<repoId>/index-state`
  must say `status: "full"` (`repoId` is in the PR page URL
  `/repos/<repoId>/pulls/<number>`).
- **Test PR:** a PR on the DevDigest repo itself that changes an exported
  helper imported by ≥2 other files, e.g. one in
  `server/src/modules/reviews/helpers.ts` or
  `client/src/components/diff-viewer/helpers.ts`.
- **Partial / degraded:** show a repo or PR whose index is `partial` (or with
  `REPO_INTEL_ENABLED=false` → `flag_off`) and the badge + Resync button.
- **No callers:** a PR that only touches a file whose symbols nobody imports.
- **Claude Code:** ask for the impact map of the same PR → `get_blast_radius`
  returns the same groups and counts as the card.
- One sentence for the video: the map is a read of the index repo-intel built
  at clone time, so it needs neither a model call nor a re-parse.

## Known limitations (v1)

- The index reflects `lastIndexedSha` (the synced branch), not the PR head: a
  symbol **added** by the PR is not in `changedSymbols` until the PR's commit
  is indexed. Lines and links are consistent with the index (BR13).
- Persistent callers are precise, not exhaustive: a reference whose
  `decl_file` did not resolve is not asserted as a caller (facade design).
- On the fallback path (no usable index) endpoints and crons per symbol are
  empty and the card says so via the degraded badge.

## Out of scope (v1)

- Graph view and the Tree/Graph toggle (P3).
- An LLM-written summary.
- Adding Blast Radius to the reviewer prompt or to `PrBrief` persistence.

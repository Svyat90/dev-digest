# spec — routes, their data, and their URL contract

Every screen in the studio, what it fetches, and which URL state it owns. This
is the contract an agent should check before adding a route or changing a query
parameter — the params below are shareable links and deep-link targets, so
renaming one breaks bookmarks and the e2e flows that assert on them.

Architecture: [`../docs/ui-architecture.md`](../docs/ui-architecture.md).

## Route table

| Route | File | Renders | Data |
|---|---|---|---|
| `/` | `app/(shell)/page.tsx` | redirect | `useRepos` → replaces with the first repo's PR list; no repos → onboarding CTA |
| `/onboarding` | `app/onboarding/page.tsx` | add-repository form | `useAddRepo` → `POST /repos` |
| `/repos/:repoId/pulls` | `app/(shell)/repos/[repoId]/pulls/page.tsx` | PR list table | `usePulls`, `useRepoIntelStatus` |
| `/repos/:repoId/pulls/:number` | `.../pulls/[number]/page.tsx` | PR detail, three tabs | `usePulls` (number→id), `usePullDetail`, `usePrReviews`, `usePrRuns`, `usePrActiveRuns` |
| `/agents` | `app/(shell)/agents/page.tsx` | agent list + create modal | `useAgents` |
| `/agents/:id` | `app/(shell)/agents/[id]/page.tsx` | agent editor | `useAgent`, `useProviderModels`, `useUpdateAgent` |
| `/settings/:section` | `app/(shell)/settings/[section]/page.tsx` | API keys / models | `useSettings`, `useSecretsStatus`, `useTestConnection` |

`(shell)` is a route group (no URL segment): its `layout.tsx` mounts the app shell
once, so the sidebar/top bar survive navigation. Views set the breadcrumb with
`useCrumb([...])`. `/onboarding` sits outside the group and has no shell.

## Navigation rules

1. **`/` never renders a page of its own.** It resolves the repo list and
   `router.replace`s to `/repos/<first>/pulls`. An empty repo list shows the
   onboarding call to action instead of redirecting, so a fresh install does not
   bounce into a dead route.
2. **The active repo resolves by priority: URL path → `localStorage["dd-repo"]`
   → first repo from the API** (`lib/repo-context.tsx`). A URL always wins, so a
   shared link opens the repo it names regardless of what the recipient last
   viewed.
3. **A stale `:repoId` is not an error.** `useRepoNotFound` renders a friendly
   empty state rather than surfacing a 404 — a deleted repo is an expected state
   in a local-first tool.
4. **The PR detail route is keyed by PR *number*, every PR API by the row's
   *uuid*.** The page resolves number → uuid through the cached pulls list, which
   is why it depends on `usePulls` even though it renders a single PR. Opening
   the route cold therefore fetches the list first; this is deliberate — it keeps
   URLs human (`/pulls/482`) without a second lookup endpoint.

## URL state contract

State that must survive a reload, a back button, or being pasted to someone else
lives in the URL. Everything else is component state.

| Param | Route | Values | Meaning |
|---|---|---|---|
| `?status=` | PR list | `all`, `needs_review` (default), `reviewed`, `stale` | filter chip |
| `?tab=` | PR detail | `overview` (default), `findings`, `diff` | active tab. `findings` is the tab labelled **Agent runs** — the internal key predates the label |
| `?trace=<runId>` | PR detail | run uuid | opens the run trace drawer on that run |
| `?severity=` | PR detail | `CRITICAL`, `WARNING`, `SUGGESTION` | filters every run's findings panel to one severity |

Two rules about reading them:

- **An unrecognised value reads as "no filter", never as "show nothing".** A
  hand-edited or stale link must degrade to the unfiltered view; an empty page
  with no explanation is the failure mode being avoided.
- **Writing a param goes through the page's `setParam` helper**, which deletes
  the key when the value is `null` and uses `router.replace` — filter changes are
  not history entries, but they are shareable.

## Presentation invariants

These hold across screens and are the ones most easily broken by an isolated
change:

1. **A missing number renders as an em dash, never as a fabricated zero.**
   `formatUsd(null)` → `—`; `formatUsd(0)` → `$0`, because some models genuinely
   cost nothing. Route every USD value through `lib/format.ts` rather than
   formatting inline — the cost surfaces live in three separate subtrees and
   drifting formatters is exactly how they stop matching.
2. **The PR list's columns are data-driven.** `COLUMN_KEYS`, the `GRID` template
   and `RIGHT_ALIGNED_COLUMNS` in `app/(shell)/repos/[repoId]/pulls/constants.ts` must
   change together — the header and the row both render from them, so a column
   added to one and not the others silently shifts every cell.
3. **The whole PR row is a navigation target.** Anything interactive inside a
   cell either stops propagation or is deliberately non-interactive. Severity
   chips in the FINDINGS column are non-interactive by design: filtering lives on
   the detail page, and a chip that swallowed the click would make the row's
   primary action unreachable in that cell.
4. **Run outcome is derived from counts, not from the model's verdict.** A
   settled run with blockers reads `rejected` (red), never a green `done`; the
   timeline colours on the denormalised `blockers` / `findings_count` on the run
   row, which is the same signal the CI gate uses.
5. **Severity counters always count the full set**, never the filtered subset —
   otherwise clicking one counter makes the others appear to vanish.

## Screens deliberately absent

The nav shows entries for features later lessons add (Skills, Memory, Eval,
Multi-Agent Review, CI Runs, Agent Performance). Their i18n namespaces exist in
`messages/en/` as placeholders. Neither the nav entries nor the namespaces are
dead code to remove.

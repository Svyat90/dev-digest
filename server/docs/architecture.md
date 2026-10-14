# server — architecture

How `@devdigest/api` is put together: what happens to a request, who constructs
what, and where the seams are. The API *map* (which route belongs to which
module) lives in [`../README.md`](../README.md) — this document is the layer
underneath it.

Read this before adding a module, touching the DI container, or changing the
error envelope. For the review cycle itself see
[`../specs/review-flow.md`](../specs/review-flow.md).

## Request lifecycle

```mermaid
flowchart LR
  REQ["HTTP request"] --> PLUG["plugins<br/>helmet · cors · rate-limit · SSE"]
  PLUG --> VAL["zod schema<br/>params / body"]
  VAL -->|invalid| ERR422["422 before the handler runs"]
  VAL --> MOD["module plugin<br/>modules/&lt;name&gt;/routes.ts"]
  MOD --> SVC["service"]
  SVC --> DI{"Container"}
  DI --> ADP["adapters (ports)"]
  SVC --> DB[("Drizzle → Postgres")]
  SVC -.->|throws| EH["error handler<br/>structured envelope"]
```

Four things about this order are deliberate:

1. **Plugins register before modules.** Module plugins are encapsulated, so they
   inherit only what was registered before them — helmet, cors, rate-limit, SSE
   and the shared error handler. Registering a plugin after the module loop
   silently excludes every route.
2. **Validation is schema-first.** Routes declare zod `params` / `body` via
   `fastify-type-provider-zod`, and the same schema drives response
   serialization. One definition, both directions. A handler that calls
   `Schema.parse(req.body)` by hand is working around the mechanism, not with it.
3. **The body cap is explicit** (`bodyLimit`, 1 MB in `app.ts`). Every legitimate
   payload here — settings, a PR comment, an agent prompt — is far below it.
4. **Rate limiting is global with per-route overrides**, and disabled entirely
   under `NODE_ENV=test` so integration suites can hammer `app.inject()`. SSE and
   the health routes opt out via `config: { rateLimit: false }`.

### Health

- `GET /health` — liveness. No DB, no module, no rate limit.
- `GET /health/ready` — readiness. Issues `select 1`; a failure returns **503**,
  not 500, so an orchestrator reads "not ready yet" rather than "crashed".

### Error envelope

Every failure leaves as `{ error: { code, message, details? } }`. The handler in
`app.ts` branches in this order, and the order matters:

| Case | Status | Note |
|---|---|---|
| zod request-validation failure | 422 | raised by the type provider, before the handler |
| response serialization failure | 500 | the offending object is logged, never returned |
| `ZodError` (by `instanceof` **or by shape**) | 422 | service-level `.parse()` calls |
| `AppError` subclass | `err.statusCode` | `NotFoundError`, `ConfigError`, … |
| anything else | 500 | logged in full |

The shape check for `ZodError` exists because `instanceof` fails across duplicate
zod module instances (the vendored contracts and the API can resolve different
copies). Simplifying it to `instanceof` reintroduces 500s where a 422 belongs.

## Dependency injection

`platform/container.ts` is the composition root. One `Container` per app
instance, decorated onto Fastify as `app.container`.

- **Adapters are lazy.** `git`, `codeIndex`, `depgraph`, `tokenizer`, `priceBook`
  and the repositories are constructed on first access and memoised. Anything
  needing a secret (`github()`, `llm(id)`, `embedder()`) is `async`, because the
  key comes from `SecretsProvider` at call time rather than at boot.
- **Tests inject doubles** through `ContainerOverrides`, and an override always
  wins over construction. `src/adapters/mocks.ts` holds the standard doubles
  (`MockLLMProvider`, `MockGitClient`, …), so the unit lane needs no keys and no
  network. `new SomeAdapter()` inside a service defeats all of this.
- **Shared repositories live here**, not inside a feature module: `agentsRepo`,
  `reviewRepo` and the `repoIntel` facade are cross-cutting, so consumers reach
  them through the container instead of importing another module's folder.

- **Run-start limit.** `container.runStartLimiter` (`platform/run-start-limiter.ts`)
  is one in-memory counter per container: 10 eval run starts per minute per
  workspace, unlimited under `nodeEnv=test`, overridable through
  `ContainerOverrides.runStartLimiter`. Routes reach it only through the
  `modules/_shared/run-start-guard.ts` preHandler (`runStartGuard(container)`),
  which answers 429 `run_start_rate_limited` before the handler runs.
  `POST /agents/:id/eval-runs`, `POST /skills/:id/eval-runs`,
  `POST /{agents|skills}/:id/eval-cases/:caseId/check` and
  `POST /eval-dashboard/run-all` share it; a run-all costs one start. Counts reset on restart (single API instance per DB).

### Ports

| Port | Default implementation | Notes |
|---|---|---|
| `SecretsProvider` | `adapters/secrets/local.ts` | the single read chokepoint for keys |
| `AuthProvider` | `adapters/auth/local.ts` | `LocalNoAuthProvider` → the seeded workspace |
| `GitHubClient` | `adapters/github/octokit.ts` | requires `GITHUB_TOKEN`, else `ConfigError` |
| `GitClient` | `adapters/git/simple-git.ts` | clones into `config.cloneDir`; `diff-parser.ts` beside it |
| `CodeIndex` | `adapters/codeindex/ripgrep.ts` | ripgrep search + `extract.ts` |
| `LLMProvider` | `adapters/llm/{openai,anthropic}.ts`, `OpenRouterProvider` from reviewer-core | cached per id |
| `Embedder` | `adapters/embedder/openai.ts` | gated by `EMBEDDINGS_ENABLED`; throws *before* constructing the client, so a disabled build makes zero OpenAI calls |
| `DepGraph` | `adapters/depgraph` (dependency-cruiser) | repo-intel indexing only |
| `Tokenizer` | `adapters/tokenizer` (js-tiktoken) | repo-map budget search |

### Secrets and config

`AppConfig` (`platform/config.ts`) deliberately carries **no** secrets. Keys are
read through `LocalSecretsProvider`, which merges a JSON file
(`~/.devdigest/secrets.json`, mode `0600`) over `process.env`, with the stored
value winning so a key typed into Settings beats a stale shell export.
`GITHUB_TOKEN` is canonical; `GITHUB_PAT` is accepted as a read-only fallback.

Swapping in a Vault-backed provider therefore touches one file and no call sites.

### Pricing

`container.priceBook` fetches live OpenRouter model prices and falls back to the
static `adapters/llm/pricing.ts` table for OpenAI/Anthropic and for a cold or
failed cache. With no OpenRouter key it degrades to `[]` rather than throwing —
cost attribution is best-effort, and a missing price must read as *unknown*
(`null`), never as free (`0`).

## Anatomy of a module

```
src/modules/<name>/
  routes.ts        # default-exported Fastify plugin — the only entry point
  service.ts       # orchestration; talks to the container, not to adapters directly
  repository.ts    # Drizzle queries for this module's tables
```

Register it with one import and one entry in `src/modules/index.ts`. Filesystem
autoload is deliberately unused: static registration is the only form that works
identically under `tsx`, a bundler, and vitest, since native `import()` of `.ts`
is not portable. `@fastify/autoload` sitting in `dependencies` is not a hint to
switch.

Cross-cutting helpers live in `modules/_shared/` — `getContext(container, req)`
resolves `{ workspaceId, userId }` through the `AuthProvider` so no module
re-derives tenancy, `schemas.ts` holds `IdParams`, and `run-start-guard.ts`
holds the preHandler every eval run-start route uses.

The `eval-dashboard` module (`modules/eval-dashboard/`) calls no model: its
service receives only repository `Pick`s and a structural `EvalRunStarter` port
(`const r: Port = container.evals`), so run-all reaches `startRun` without
importing the `evals` module.

The `evals` module outgrew the three-file shape, the way `reviews/` did:

```
src/modules/evals/
  routes.ts                    # case routes registered for both owners (agents, skills)
  service.ts                   # EvalService: agent and skill runs, remembered agent, getRun
  case-service.ts              # EvalCaseService: get, create, edit (revisions), single-case runs
  run-executor.ts              # runCaseReview (one case through the engine, scored)
                               # and resolveRunConfig (agent config, or agent + skill)
  repository.ts                # EvalRepository: SPEC-04 cases and agent runs, getRun
  repository/case.repo.ts      # EvalCaseRepository: cases per owner, revisions, checks
  repository/skill-eval.repo.ts  # SkillEvalRepository + the shared toSkillRunSummary mapper
```

Full runs, skill runs and single-case runs all go through `runCaseReview`, so a
case is executed and scored the same way whichever path started it.
`resolveRunConfig` throws every refusal (unknown owner, no agent, a deleted
agent) before any model call. For a skill it takes the remembered agent's
config and turns the skill on for that run only (`withSkillForRun` in
`domain/evals/case-editor.ts`): at its linked position when the agent links
it, otherwise after the agent's other skills; `agent_skills` is never written.
`repository.ts` imports `toSkillRunSummary` from `repository/skill-eval.repo.ts`
— never the other way round, so no import cycle forms.

The case rules live in a contract file, not in the module:
`vendor/shared/contracts/eval-case.ts` holds the strict diff parser
(`parseCaseDiff`), the draft validator (`validateCaseDraft`) and the limits.
It imports only zod and `eval-ci.ts`, and it is byte-identical in the client
copy. The Case Editor runs `validateCaseDraft` while the user types and
`EvalCaseService` runs the same function on every create and save, so a form
the editor accepts does not fail on save for a rule it could have shown.

The engine's own diff parser (`adapters/git/diff-parser.ts`, used by the review
path and injected into eval runs) skips a `\ No newline at end of file` line
inside a hunk: the line takes no new-side number and does not move the cursor.
The strict parser treats the marker the same way (a `meta` line with no new-side
number), so line numbers written in the editor match the numbers a run grounds
and scores against.

## Data layer

`db/schema.ts` is a barrel over thirteen domain files in `db/schema/`:

| File | Tables |
|---|---|
| `core.ts` | `users`, `workspaces`, `workspace_members`, `settings` |
| `repos.ts` | `repos` |
| `pulls.ts` | `pull_requests`, `pr_files`, `pr_commits` |
| `reviews.ts` | `reviews`, `findings`, `pr_intent`, `pr_brief` |
| `runs.ts` | `agent_runs`, `run_traces`, `multi_agent_runs` |
| `agents.ts` | `agents`, `agent_versions`, `agent_skills` |
| `repo-intel.ts` | `repo_index_state`, `file_edges`, `file_facts`, `file_rank`, `repo_map_cache` |
| `context.ts` | `onboarding`, `code_chunks`, `symbols`, `references` |
| `knowledge.ts` | `conventions`, `memory` |
| `skills.ts` | `skills`, `skill_versions` |
| `eval.ts` | `eval_cases`, `eval_case_revisions`, `eval_suite_runs`, `eval_runs`, `eval_case_checks`, `skill_eval_agents`, `conformance_checks`, `composed_reviews` |
| `ci.ts` | `ci_installations`, `ci_runs` |
| `ops.ts` | `installed_plugins`, `digests`, `jobs` |

The schema is **complete from day one**: most of these tables are empty and
belong to later lessons. They are not dead code to clean up.

The eval tables (`eval.ts`) split identity from content and runs from results:

- `eval_cases` holds a case's identity only. A case belongs to an agent
  (`agent_id`) or to a skill (`skill_id`); both FKs cascade, so deleting the
  owner deletes its cases. Case names are unique per set —
  `eval_cases_owner_name_uq` on `(workspace_id, owner_kind, owner_id, name)`.
  `EvalCaseService` checks the name first to name the reason; the index is the
  guarantee, and a clash it catches (a concurrent save) is answered as the same
  `name_taken` issue.
- `eval_case_revisions` holds the case content (frozen diff, files, meta,
  expectation, and `expected_output` for a hand-written case). It is
  append-only: no code updates or deletes a row, only the FK cascade from the
  case removes them; a case's current revision is its highest `revision`. A
  save that changes the content appends the next revision; a name-only save
  appends none.
- `eval_suite_runs` is one run over all cases of one owner. It stores the
  version, the config snapshot, and the covered `(case, revision)` list as
  `jsonb`, which is never nulled. An agent run sets `agent_id`; a skill run
  leaves `agent_id` NULL and sets `skill_id` (cascade), `skill_version`,
  `via_agent_id` (`ON DELETE SET NULL`) and `agent_name`, so it outlives the
  agent it ran through. Two partial unique indexes allow one `running` run per
  agent (`eval_suite_runs_one_running_uq`) and one per skill
  (`eval_suite_runs_one_running_skill_uq`); since a skill run has a NULL
  `agent_id`, it never blocks the agent's own run.
- `eval_runs` holds the per-case results of a suite run; each row records the
  `case_revision_id` it ran. `case_id` and `case_revision_id` are `ON DELETE SET
  NULL`, so deleting a case keeps its past results.
- `eval_case_checks` holds single-case runs — scratch results that never enter
  run history. One row per revision (`eval_case_checks_revision_uq`): starting a
  check again resets that row, so it always holds the newest result.
  `eval_case_checks_one_running_uq` allows one `running` check per case.
- `skill_eval_agents` remembers, per skill, the agent its cases run through.
  `agent_id` is `ON DELETE SET NULL` and `agent_name` is kept, so the UI can say
  which agent no longer exists.

Every agent view — the agent's run history, the eval dashboards, compare and
Promote — reads `eval_suite_runs` with `agent_id IS NOT NULL`, so skill runs
never reach them. The one owner-neutral read is `EvalRepository.getRun`
(`GET /eval-runs/:id`): it maps a skill run through `toSkillRunSummary` and an
agent run through its own mapper, and tags the result with `owner_kind`.

Promote (`POST /agents/:id/eval-runs/:runId/promote`) is written by
`eval-dashboard/repository/promotion.repo.ts` in ONE `db.transaction`: it
updates `skills` and `agents`, relinks `agent_skills`, and appends
`skill_versions` and `agent_versions` rows. Versions are only ever appended,
never updated or deleted.

The contract and behaviour of the pipeline live in the evals module
(`modules/evals/`); the SPECs are `specs/04-eval-pipeline-2026-10-11.md` and,
for the Case Editor, single-case runs and skill evals,
`specs/06-case-editor-2026-10-12.md`.

Two rules hold across the schema, with one documented exception:

- Every domain table carries `workspace_id` and every query scopes by it, even
  though auth currently resolves to a single seeded workspace.
- **`findings` is the exception** — it has no `workspace_id` and no indexes.
  Tenancy reaches a finding only through its review, so any aggregate over
  findings must join `reviews` and scope on `reviews.workspace_id`. That join is
  the tenancy boundary, not an optimisation.

Migrations are generated with `pnpm db:generate` (drizzle-kit) and applied with
`pnpm db:migrate`. **They never run on boot** — a fresh database that was not
migrated fails at the first query, by design, rather than mutating itself under a
running server.

## Background work and observability

- **Run events** stream over SSE (`platform/sse.ts`, `runBus`). A run publishes
  `info` / `tool` / `result` / `error` events; the same bus answers
  `isCancelled(runId)`, which is how cancellation reaches a running review.
- **Run traces** are written once, at the end of a run, as a single JSON
  document in `run_traces` — not as a stream of rows. `platform/trace-builder.ts`
  and `run-logger.ts` assemble it.
- **Orphan reaping.** A previous process that died mid-run leaves `agent_runs`
  rows stuck in `running` with no runner to finish or cancel them. `app.ts`
  reaps them **before** the server accepts requests: a fresh process cannot have
  in-flight runs of its own yet, so every `running` row at that moment is
  genuinely orphaned. This assumes a single API instance per database; replicas
  would need per-instance scoping or heartbeats.
- **Eval runs.** `POST /agents/:id/eval-runs` answers `202` and continues the run
  in the background (`modules/evals/service.ts`). A run a dead process left in
  `running` would block new runs of that agent through the one-running index, so
  `app.ts` also closes them on boot (`EvalService.reapStaleRuns`). They are not
  marked failed blindly: each goes through the same close rule as a live run —
  `completed` when at least one case was scored (not `errored`), `failed`
  otherwise — with its finish time taken from the last stored result (or the start
  time when it has none). The reaper reads every `running` suite run, so skill
  runs are closed the same way. Same single-instance assumption as above.
- **Single-case runs.** `POST …/eval-cases/:caseId/check` answers `202` and
  runs the case in the background (`EvalCaseService.startCheck`). A check a
  dead process left `running` would block the next check of that case through
  the one-running index, so `app.ts` closes every such row on boot as `errored`
  with the reason "interrupted by a server restart"
  (`EvalCaseService.reapStaleChecks`).

## repo-intel

The codebase indexer is a module, not a separate service:
[`../src/modules/repo-intel/README.md`](../src/modules/repo-intel/README.md) has
its pipeline diagram and the full facade. What matters at this level:

- Everything downstream reads through the `RepoIntel` facade
  (`container.repoIntel`), never through the pipeline internals.
- It is **read-only during a review** — indexing happens on clone and on fetch,
  so adding repo context to a prompt costs no analysis at request time.
- It is **best-effort**: an unindexed or partially indexed repo returns empty
  results instead of throwing, and the review degrades to diff-only. The degraded
  status and reason stay observable through `getIndexState()`.

## Testing seams

The container is the seam that makes the unit lane hermetic, and a real Postgres
is the seam integration tests refuse to fake. Full policy:
[`../../TESTING.md`](../../TESTING.md). The one rule that bites if forgotten: a
DB-backed test **must** be named `*.it.test.ts`, or the split stops covering it.

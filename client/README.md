# `@devdigest/web` — the studio (Next.js 15)

The DevDigest UI: import repos, browse pull requests, run and read AI reviews,
and author agents. App Router + React Server/Client components, data via
**TanStack Query** hooks over the Fastify API. (This is the starter surface;
course lessons add the Skills, Memory, Eval, Blast/Brief, multi-agent, CI, and
dashboard screens.)

- **Stack:** Next.js 15 (App Router), React 19, TanStack Query, `next-intl`
  (messages in `messages/<locale>/*.json`), `recharts`, `mermaid`,
  `react-markdown`. UI primitives are vendored under `src/vendor/ui`
  (`@devdigest/ui`) and shared Zod contracts under `src/vendor/shared`
  (`@devdigest/shared`).
- **API base:** `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`), used by
  `src/lib/api.ts`. Every data hook lives in `src/lib/hooks/*`.
- **Run:** `pnpm dev` (`:3000`). **Test:** `pnpm test` (vitest + jsdom, fetch
  mocked — no API needed). **Typecheck:** `pnpm typecheck`.

## UI route map

Routes (`src/app/**/page.tsx`) and the API surface each leans on (via
`src/lib/hooks/*` → `src/lib/api.ts`):

```mermaid
flowchart TD
  ROOT["/"] -->|"useRepos → GET /repos"| PULLS["/repos/:repoId/pulls<br/>PR list"]
  ONB["/onboarding<br/>add repo"] -->|"POST /repos"| API[("Fastify API")]
  PULLS --> PR["/pulls/:number<br/>review detail<br/>(overview · diff · findings)"]

  PULLS -.->|"sidebar Project Context · g c"| CTX["/repos/:repoId/context<br/>document browser"]
  AGENTS["/agents"] --> AGENT["/agents/:id<br/>editor (config · skills · context · evals tab)"]
  SKILLS["/skills"] --> SKILL["/skills/:id?tab=evals<br/>detail (context · evals tab, Run on evals)"]
  AGENT -->|"New eval case · Edit row"| CASEED["Case Editor dialog<br/>(components/case-editor)"]
  SKILL -->|"New eval case · Edit row"| CASEED
  SETTINGS["/settings/:section<br/>API keys · models"]
  EVALS["/evals<br/>Eval Dashboard"] --> AGENTEVAL["/evals/:agentId?range=<br/>agent dashboard · compare · promote"]

  PULLS -->|"GET /repos/:id/pulls · /repos/:id/index-state"| API
  PR -->|"GET /pulls/:id · /reviews · /pulls/:id/comments · /pulls/:id/smart-diff · /pulls/:id/blast · /pulls/:id/history<br/>GET · POST /pulls/:id/brief<br/>POST /pulls/:id/review · /findings/:id/(accept|dismiss) · /repos/:id/resync"| API
  CTX -->|"GET /repos/:id/context/docs(/content) · /context-docs/usage"| API
  AGENT -->|"GET · PUT · POST /agents/:id/context-docs<br/>GET /agents/:id/eval-cases · GET · POST /agents/:id/eval-runs<br/>DELETE /eval-cases/:id"| API
  SKILL -->|"GET · PUT · POST /skills/:id/context-docs<br/>GET /skills/:id/eval-cases · GET · POST /skills/:id/eval-runs<br/>GET · PUT /skills/:id/eval-agent · GET /agents (agent picker) · DELETE /eval-cases/:id"| API
  CASEED -->|"GET · POST · PUT /(agents|skills)/:id/eval-cases(/:caseId)<br/>POST …/eval-cases/:caseId/check"| API
  AGENTS -->|"/agents · /agents/:id"| API
  SETTINGS -->|"/settings · /providers"| API
  EVALS -->|"GET /eval-dashboard · POST /eval-dashboard/run-all"| API
  AGENTEVAL -->|"GET /agents/:id/eval-dashboard?range= · GET /agents/:id/eval-runs/compare · POST /agents/:id/eval-runs(/:runId/promote)"| API
```

Cross-cutting chrome lives in `src/components/app-shell` (nav, breadcrumbs,
`g`-then-key shortcuts). Pages are thin; feature logic sits in colocated
`_components/<Name>/` folders, each with its own `*.test.tsx`.

## Testing

Component/interaction tests (`*.test.tsx`) run under vitest + jsdom with `fetch`
mocked, so they need neither the API nor a browser. The real browser journeys
(client + API + seeded DB) are covered by the deterministic agent-browser suite
in [`../e2e`](../e2e/README.md) and the `e2e-web.yml` workflow. See
[`../TESTING.md`](../TESTING.md).

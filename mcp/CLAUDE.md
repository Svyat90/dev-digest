# mcp — agent map

`@devdigest/mcp`: a stdio MCP server that exposes DevDigest's review flow to
Claude Code. It is a thin client over the Fastify REST API — it holds no
database driver, no secrets and no review logic. Tools, env and troubleshooting
are in README.md.

## Before answering

Always search the relevant package's `docs/`, `specs/`, and `INSIGHTS.md` for
what the user asks about FIRST — these are curated and may already answer it —
then read code.

## Non-default conventions

- **stdout is the protocol channel.** Never `console.log` or write to stdout.
  Every log line goes through `src/log.ts` to stderr.
- **MCP SDK v1 only** (`@modelcontextprotocol/sdk` 1.31.x). SDK v2 needs Zod 4,
  and this repo is Zod 3. Keep a single `zod` copy (`~3.25.76`); a second copy
  breaks the SDK's schema handling.
- **No imports from `server/` or `reviewer-core/`.** mcp talks to the API over
  HTTP only, so `dist/` stays self-contained and there is one Zod copy.
- **`src/api/schemas.ts` are hand-written Zod projections of API responses.**
  When a server response contract changes, update the projection in the same
  change. Drift surfaces as an `api_shape_mismatch` tool error.
- **Layering.** `domain/` is pure (no fetch, no SDK, no `process`) <- `api/`
  (HTTP and projections, no MCP SDK) <- `tools/` (SDK; composes api + domain)
  <- `server.ts` / `index.ts` (composition root). Only `index.ts` and
  `config.ts` read `process.env`.
- **Untrusted text never goes in `next`.** Titles, rationales, API messages and
  run errors are data: they may appear only in `findings` or `detail`. `next`
  is built from fixed templates and validated identifiers.
- **`run_agent_on_pr` is the only tool that spends LLM budget.** It reuses an
  active run of the same agent instead of starting a second one.
- Installs with **npm**, not pnpm. `npm run build` emits `dist/`.

## Tool-design rules

Apply these to every new or changed tool.

1. **P1 — Outcome, not operation.** A tool returns what the caller wants (a
   verdict and findings), not a step of the API. `run_agent_on_pr` starts,
   waits and returns the result in one call.
2. **P2 — Flat arguments.** Primitive, top-level inputs with `.describe()` and
   examples (`repo` as `"owner/name"`, `pr_number`). No nested objects, no
   internal ids the model would have to look up first.
3. **P3 — Concise, structured answer.** Return only what decides the next step:
   a verdict, counts, truncated findings, a page limit (at most 50) and a
   `next_cursor`. Never the raw API payload.
4. **P4 — The error leads onward.** Every failure is `isError: true` with
   `{error, message, next, detail?}`, where `next` names the exact tool call or
   action that fixes it. A deadline is not an error: it returns
   `status: "running"` with a `run_id`.

## Commands

```sh
npm run build       # tsc -p tsconfig.build.json -> dist/
npm run typecheck   # src + test, no emit
npm test            # vitest, hermetic (fake fetch, in-memory MCP transport)
npm start           # node dist/index.js (needs a build first)
```

## Do-not-touch

- `dist/` — build output, git-ignored.

## Read when

- Read `README.md` before adding or changing a tool, an env var or the
  `.mcp.json` entry.
- Read `../server/src/modules/repos/routes.ts` (`/repos/lookup`) and
  `../server/src/modules/reviews/routes.ts` (`/runs/:id`) before changing what
  mcp reads from the API.
- Read `../server/src/modules/blast/routes.ts` before changing what
  `get_blast_radius` reads.
- Read `../TESTING.md` before adding or changing a test.
- Read `INSIGHTS.md` before starting non-trivial work here.

Found a trap that cost you time? Capture it with the `engineering-insights`
skill, which appends it to `INSIGHTS.md`.

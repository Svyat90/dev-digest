---
name: dependency-checker
description: "Audits the dependencies of every DevDigest package (server, client, reviewer-core, e2e, mcp, evals — every top-level directory with a package.json): draws a Mermaid dependency graph with import and runtime (HTTP) edges, reports installed size per package and per dependency (own and with transitive deps) grouped by category, finds unused, phantom, misplaced, drifted, duplicated, heavy and rule-breaking dependencies, then ranks findings P0/P1/P2/Info with concrete advice. Use when the user asks to check, audit, analyse or visualise dependencies, node_modules size, package.json bloat, unused or duplicated npm packages, version drift between packages, or how the packages depend on each other — even if they never say 'dependency'. Read-only: it proposes changes, never installs, removes or upgrades anything. Not for security CVE scanning (security skill) or for server ring/import-direction rules (onion-architecture)."
---

# Dependency Checker

One run produces one structured report: where each package depends on what, how
much it weighs, what is wrong, and what to fix first. **Every number comes from the
collector script.** You read, judge and rank; you never recount sizes, shares or
imports by hand.

## Repo facts that change the analysis

- **Not a monorepo.** Each top-level package has its own `package.json` and lockfile
  (`server`, `client`, `evals` use pnpm; `reviewer-core`, `e2e`, `mcp` use npm). There
  is no `workspace:*`. Never write that packages are "linked by a workspace".
- **Three kinds of edge, never mixed:** tsconfig path aliases (`@devdigest/shared`,
  `@devdigest/reviewer-core`, `@devdigest/ui`); relative imports that leave the package
  (`relative-escape`, always a finding); and runtime HTTP calls (`runtime-http`: `mcp`
  and `client` call the API on `:3001`, `e2e` drives the web app on `:3000`).
- `client/src/vendor/shared` is a drifted copy of `server/src/vendor/shared`;
  `client/src/vendor/ui/**` is vendored and do-not-touch.
- Rules that turn a dependency into a finding: Zod 3 only (no `zod/v4`, `zod/mini`,
  `@zod/*`); MCP code uses `@modelcontextprotocol/sdk` v1, never
  `@modelcontextprotocol/server|client` v2.

## Workflow

```
Dependency check:
- [ ] 1. Collect (run the script)
- [ ] 2. Build the graph
- [ ] 3. Size table
- [ ] 4. Find and rank findings
- [ ] 5. Write the report
```

**1. Collect.** From the repo root run
`node .claude/skills/dependency-checker/scripts/collect.mjs --summary [pkg ...]`
(no package = all of them). The output holds:

- `summary` — per-package totals, shares, prod/dev/peer counts and the top 10
  dependencies by size, ready to copy;
- per package: `internalEdges` (with `fromKinds`: src / test / config),
  `forbiddenImports`, `undeclaredImports` and `flaggedDependencies` (only the
  dependencies that can become a finding);
- `versionDrift` and `duplicates` across packages.

Drop `--summary` only when you need one dependency's full record. A package with
`installed: false` has no sizes: write `not installed` and do not estimate. Never run
`npm install`/`pnpm install` to fill the gap.

**If the request already contains the data** (package lists, sizes, grep results) — as
the eval cases do — use it as given, skip step 1, and do not ask for tool access.

**2. Build the graph.** Section 2 of [references/report-template.md](references/report-template.md):
one `flowchart LR`, violation edges first, then aliases, runtime edges and the heaviest
external dependencies.

**3. Size table.** Section 3 of the template, copied from `summary.topByTransitiveSize`.
Show `ownMb` (the package's own directory) and `transitiveMb` (with every dependency it
pulls in, each counted once) side by side. They are on-disk sizes, not bundle sizes.

**4. Find and rank.** Apply [references/severity.md](references/severity.md): go
through its categories one by one against the JSON. Each finding names a package, a
dependency or file, and quotes its evidence (a JSON field and value, or a path:line).

**5. Write the report.** Exactly the five sections of the template, in order, no
extra top-level sections.

## Output rules

- **Language: Ukrainian** for all report prose. Headings stay `Ukrainian (English)`;
  package names, paths, tiers (`P0`..`Info`) and code stay as they are.
- Show the report in chat. Write a file (`docs/dependency-reports/YYYY-MM-DD.md`) only
  when the user asks for one.
- **Read-only.** Removals, upgrades and moves are recommendations for the user to
  confirm ("видалити `@fastify/autoload` з `server/package.json`"), never actions taken.
- No generic advice ("consider optimizing dependencies"). Every recommendation names a
  package, a dependency and a file.
- Do not invent numbers. A missing value is `—` with the reason.

## Known limits (say them when they matter)

- Imports are parsed with each package's own `typescript` (`importParser`); without it
  the regex fallback can count imports written inside strings.
- Files the collector does not parse — JSON configs, shell scripts, `.flow.json` specs —
  can use a dependency it reports as `none-found`.
- `transitiveMb` does not subtract dependencies shared with other packages, so
  per-dependency sizes do not add up to `nodeModulesMb`.

## References

- [references/report-template.md](references/report-template.md) — the five report
  sections, with a filled example and the graph rules.
- [references/severity.md](references/severity.md) — tiers, the finding categories with
  their JSON fields, size rules and judgement rules.
- Collector tests: `evals/skills/dependency-checker/collect.test.ts`.

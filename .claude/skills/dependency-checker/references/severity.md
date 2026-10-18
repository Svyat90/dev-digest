# Severity tiers and finding categories

Rank every finding. An unranked list is a failed report.

| Tier | Meaning | Action |
|---|---|---|
| **P0** | Breaks a repo rule or an architectural boundary in shipped code, or can fail at runtime | Fix before the next merge |
| **P1** | Real waste or a latent risk, no rule broken | Fix in the current iteration |
| **P2** | Hygiene, small gains | Fix when touching the file |
| **Info** | Observation, no action required | None |

## Categories

Check each one against the collector's JSON. Every category has a field; none needs a
manual grep except where the row says "verify".

| # | Category | JSON source | Default tier |
|---|---|---|---|
| 1 | **Forbidden import** (`zod/v4`, `zod/mini`, `@zod/*`, `@modelcontextprotocol/server\|client`) | `forbiddenImports` | P0 |
| 2 | **Package boundary broken**: a `relative-escape` edge | `internalEdges[kind=relative-escape]`, `fromKinds` | P0 if `fromKinds` has `src`; P1 if only `test`/`config` |
| 3 | **Dependency in the wrong direction**: `reviewer-core` (plain TS, domain) depending on `server` | `internalEdges` with source `reviewer-core`, `targetPackage: server` | Rank by row 2 for a relative path; Info for the `@devdigest/shared` alias (documented contract home) |
| 4 | **Undeclared (phantom) import**: a package imported but not in that `package.json`; it works only through hoisting or a sibling's install | `undeclaredImports` | P0 if `src > 0`; P1 if only tests/config |
| 5 | **Unused runtime dependency** | `usedBy: "none-found"`, `section: dependencies` | P1 (it ships and is installed) |
| 6 | **Unused devDependency** | `usedBy: "none-found"`, `section: devDependencies` | P2 |
| 7 | **Redundant direct declaration**: never imported, but another declared dependency already depends on it | `usedBy: "transitive-of:…"` | P2, "verify" |
| 8 | **Runtime dependency that belongs in devDependencies** | `onlyOutsideSrc: true` | P1 |
| 9 | **Version drift** across packages | `versionDrift` | P1 for a `dependencies` entry or `zod`; Info for `@types/*` or patch-only drift within one range |
| 10 | **Heavy dependency** | `transitiveMb`, `core`, `importedIn` | see "Size rules" |
| 11 | **Duplicate across packages**, same version | `duplicates[sameVersion=true]` | Info (separate lockfiles make this expected) |
| 12 | **Missing lockfile** | `manager: "unknown"` | P1 |
| 13 | **Used only through a string mention** | `usedBy: "string-mention…"` | Info, "verify manually" |
| 14 | **Runtime (HTTP) coupling**: one package needs another running | `internalEdges[kind=runtime-http]` | Info (graph only); never a defect by itself |

`usedBy: "peer-of:…"` (for example `react-dom` for `next`) and `"tooling (implicit)"`
mean *required*. Never report them as unused.

## Size rules

Install size is not bundle size. Rank a heavy dependency by what it costs the user of
the package, not by disk alone:

- `core: true` (`next`, `react`, `fastify`, `drizzle-orm`, `typescript` …) is the
  point of the package: always Info, whatever the size.
- `transitiveMb ≥ 50` and `importedIn.src ≤ 1`: P2. Say whether the one import is
  lazy (`await import(…)`), which removes it from the initial bundle; read that one
  file to check.
- `transitiveMb ≥ 50` and only `test`/`config` imports: Info (development install only).
- Anything else: no size finding.
- Quote `ownMb` and `transitiveMb` together. `ownMb` alone hides the dependency's own
  dependencies; `transitiveMb` counts each reachable package once but does not
  subtract packages that other dependencies share.

## Judgement rules

- `none-found` is a *candidate*, not proof: a dependency may be loaded by a CLI or a
  config the collector does not parse. Before ranking a `dependencies` entry, grep the
  package for the name once and cite what you found (a comment can explain it, as
  `server/src/modules/index.ts` does for `@fastify/autoload`).
- Findings in files under `vendor/` (`importedIn.vendored`) are not actionable in
  `client/src/vendor/ui/**` (do-not-touch): report them as Info.
- An alias to `@devdigest/shared` from `reviewer-core` or `server` is the intended
  contract path, not a violation by itself.
- Combine, don't repeat: three packages drifting on the same dependency is one finding.
- Order findings inside a tier by impact (MB saved, then number of files affected).

## Advice (after the findings)

Give 3–5 recommendations in priority order. Each one: the action, the file, the
expected gain (MB saved, rule restored, drift removed) and the command the user can
run *themselves* to apply it (for example `cd server && pnpm remove @fastify/autoload`).
Never run those commands.

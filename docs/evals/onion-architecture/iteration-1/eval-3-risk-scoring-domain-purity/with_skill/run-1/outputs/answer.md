# Risk scoring: placement review

Read first: `onion-architecture` SKILL.md (sections 2-5, 8, 9), `domain-is-pure` and `no-cross-module-imports` in `server/.dependency-cruiser.cjs`, and `src/domain/reviews/`.

**Short answer: no.** `scoring.ts` mixes three rings in one file, which is why `weightOf` and `scorePull` are hard to test. `repos/service.ts` also crosses a module boundary.

## What is wrong

| # | Where | Problem | Rule / section |
|---|---|---|---|
| 1 | `scoring.ts:1` | `import type { FastifyBaseLogger } from 'fastify'` in a non-route file | `no-framework-below-routes` |
| 2 | `scoring.ts:2` | Domain rule typed on `FindingRow`/`AgentRow` (Drizzle `$inferSelect` rows from `db/rows`) instead of contract types. A type-only import still counts. | dependency rule, section 3 |
| 3 | `scoring.ts:22` | `process.env.RISK_SECURITY_BOOST` read inside a rule. `process.env` is banned in domain; config belongs in `platform/config.ts`. It also makes the output depend on hidden global state, so a test must mutate env. | section 2 domain row, section 4 Env/config |
| 4 | `scoring.ts:49` | `Date.now()` inside the rule. The clock must be passed in. | section 5 Domain |
| 5 | `scoring.ts:32-50` | `scorePull` is an application use case (load findings, load agents, decide, log) living next to the pure rule. It takes a concrete `ReviewRepository` and a Fastify logger, so a test needs a repo fake plus a logger fake. This is the "test needs infrastructure to check a calculation" signal. | sections 1, 5 (impureim sandwich) |
| 6 | `repos/service.ts:4-5` | `import { ReviewRepository } from '../reviews/repository.js'` and `'../reviews/scoring.js'` reach into another module's folder. | `no-cross-module-imports` |
| 7 | `repos/service.ts:26` | `new ReviewRepository(this.container.db)` constructs a repository inside a service method, and uses `container.db`. Construction belongs to the composition side. | section 5 Application |
| 8 | `repos/service.ts:2,17` | Takes the whole `Container` rather than narrow `Deps`. | section 5 Application, examples.md #3 |
| 9 | `repos/service.ts:4` | `FastifyBaseLogger` passed into the service, so the framework type leaks inward. | `no-framework-below-routes` |
| 10 | `repos/service.ts:29-33` | The "worst level" ordering and "high risk count" are business rules sitting in the orchestration method. | section 5 Domain |
| 11 | `repos/service.ts:27` | N+1: two queries per open PR (`listFindingsForPull` plus `listAgents`, and `listAgents` is the same for every PR). | repository concern |

Also check the severity keys. The contract is `Severity = 'CRITICAL' | 'WARNING' | 'SUGGESTION'` (`vendor/shared/contracts/findings.ts:11`), but `SEVERITY_WEIGHT` is keyed `critical/major/minor/info`. If the stored value is uppercase, every weight falls through to `?? 0` and every PR scores `low`. This is probably a real bug that a pure unit test would have caught immediately. Typing the table as `Record<Severity, number>` would make the compiler catch it.

## Where each piece should live

| Piece | Home | Ring |
|---|---|---|
| `weightOf`, `levelOf`, `SEVERITY_WEIGHT`, `scoreFindings` (sum, clamp, round), `worstLevel` | `server/src/domain/reviews/risk-scoring.ts` | domain (guarded by `domain-is-pure`, importable from any module) |
| `RiskLevel`, `RiskScore` (and `RepoHealth` if the client needs it) | `server/src/vendor/shared/contracts/` (zod schema plus inferred type; the client copy must be checked too) | contracts |
| Security boost value (`RISK_SECURITY_BOOST`) | `platform/config.ts`, passed in as a parameter | composition root |
| Clock | `now: () => Date`, or the service calls `new Date()` and passes the ISO string | application edge |
| "Load findings plus agents for a PR" | `ReviewRepository` method `listScoringInputs(workspaceId, prIds[])`, one batched query, returning contract types and scoped by `workspaceId` | infrastructure |
| `scorePull` use case | `reviews/service.ts` (own module), or skip it | application |
| `RepoHealth` orchestration | `repos/service.ts` with narrow `Deps` | application |
| Cross-module access to review data | via the container (`container.reviewRepo`) or a narrow port in `Deps`, never an import of `../reviews/*` | composition root |
| Logging | the service logs through a narrow `Logger` interface, or leave it to the route | application / presentation |

### Domain (pure, no I/O)

```ts
// server/src/domain/reviews/risk-scoring.ts
import type { Severity } from '@devdigest/shared';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ScoringFinding {
  severity: Severity;
  agentName: string | null;
}

export interface ScoringConfig {
  securityBoost: number;
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  CRITICAL: 5,
  WARNING: 3,
  SUGGESTION: 1,
};

export function weightOf(f: ScoringFinding, cfg: ScoringConfig): number {
  const base = SEVERITY_WEIGHT[f.severity] ?? 0;
  return f.agentName === 'security' ? base * cfg.securityBoost : base;
}

export function levelOf(score: number): RiskLevel {
  if (score >= 7) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

export function scoreFindings(findings: ScoringFinding[], cfg: ScoringConfig) {
  const total = findings.reduce((sum, f) => sum + weightOf(f, cfg), 0);
  const score = Math.min(10, Math.round(total * 10) / 10);
  return { score, level: levelOf(score) };
}

const ORDER: RiskLevel[] = ['low', 'medium', 'high'];

export function worstLevel(levels: RiskLevel[]): RiskLevel | null {
  return levels.reduce<RiskLevel | null>(
    (acc, l) => (acc === null || ORDER.indexOf(l) > ORDER.indexOf(acc) ? l : acc),
    null,
  );
}
```

The repository joins agents and returns `{ prId, severity, agentName }`, so the domain never sees `AgentRow` or `FindingRow`. If `severity` in the DB is not the contract enum, map it in the repository.

### Application (orchestrates, thin)

```ts
// server/src/modules/repos/service.ts
import { scoreFindings, worstLevel, type RiskLevel } from '../../domain/reviews/risk-scoring.js';

export interface ReposServiceDeps {
  repos: ReposRepository;
  scoringInputs: { listForPulls(ws: string, prIds: string[]): Promise<Map<string, ScoringFinding[]>> }; // narrow port, wired from container.reviewRepo
  scoringConfig: ScoringConfig;
}

async health(workspaceId: string, repoId: string): Promise<RepoHealth> {
  const repoRow = await this.deps.repos.get(workspaceId, repoId);
  if (!repoRow) throw new NotFoundError('Repository not found');

  const pulls = await this.deps.repos.listOpenPulls(workspaceId, repoId);                 // read
  const byPr = await this.deps.scoringInputs.listForPulls(workspaceId, pulls.map((p) => p.id));
  const levels = pulls.map((p) => scoreFindings(byPr.get(p.id) ?? [], this.deps.scoringConfig).level); // pure
  return { repoId, openPulls: pulls.length, highRisk: levels.filter((l) => l === 'high').length, worst: worstLevel(levels) };
}
```

`computedAt` is dropped here because `health` does not use it. If a per-PR score endpoint needs it, the service adds `new Date().toISOString()` after calling `scoreFindings`.

## Resulting tests

- Domain, plain vitest, no container, no DB, no env, no logger, no fake clock:
  `expect(weightOf({ severity: 'CRITICAL', agentName: 'security' }, { securityBoost: 1.5 })).toBe(7.5)`;
  `levelOf(7)` is `'high'`; `scoreFindings` clamps at 10; `worstLevel([])` is `null`.
- Application: `ReposService` with a fake `Deps` (a map for the scoring inputs). No Postgres.
- Infrastructure: one `*.it.test.ts` for the batched query, including the workspace scope.

## Order of moves (each keeps `pnpm arch:check` green)

1. Extract the pure functions into `domain/reviews/risk-scoring.ts` and add unit tests. Nothing else changes yet.
2. Move `RiskLevel`/`RiskScore` into contracts and check the client copy. Pass the boost via config.
3. Add the batched repository method. Give `ReposService` narrow `Deps`, wired in the container. Delete `reviews/scoring.ts`.
4. Run `pnpm arch:check`. Do not regenerate the baseline. The new code should add zero violations.

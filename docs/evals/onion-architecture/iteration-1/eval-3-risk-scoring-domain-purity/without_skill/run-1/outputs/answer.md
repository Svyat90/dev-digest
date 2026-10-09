# Risk scoring placement review

Short answer: no. The scoring rule is pure business logic. It is stuck in `modules/reviews/` and mixed with I/O, so it is hard to test and `repos` reaches into a sibling module. Context I read: `server/CLAUDE.md` and `.dependency-cruiser.cjs`. The config says `src/domain` is pure (only `src/domain/**`, `vendor/shared` and zod may be imported), and services are the application layer.

## What is wrong

1. **`weightOf` reads `process.env` directly** (`RISK_SECURITY_BOOST`). This is a hidden input and an env read outside `platform/config.ts`. Tests have to mutate global env. It also bypasses the zod-validated `AppConfig`: `Number('abc')` gives `NaN` silently.
2. **`weightOf` takes `FindingRow` and `AgentRow`**. These are DB row types from `db/rows.js`. Pure rules should work on contract types or minimal structural types, not Drizzle row shapes.
3. **`scorePull` takes a `ReviewRepository` and a Fastify logger.** It fetches data, applies the rules and logs in one function. The test needs a repository fake and a fake logger just to check arithmetic.
4. **`scorePull` calls `Date.now()` directly.** The clock is a hidden input.
5. **`scoring.ts` mixes three roles in one file in `modules/reviews/`**: rules (`weightOf`, `levelOf`), orchestration (`scorePull`), and types.
6. **`repos/service.ts` has two problems.**
   - It does `new ReviewRepository(this.container.db)`. A service constructing a repository by hand bypasses DI, and it reaches into another module's infrastructure.
   - It imports a free function from `reviews/scoring.js`. That is a cross-module import into the reviews module's internals. It also does an N+1: two queries per open PR.
7. **The "worst level" reduction is business logic inside `health()`.** It should be a pure function too.

## Where each piece should live

| Piece | Ring / location | Why |
|---|---|---|
| `RiskLevel`, `RiskScore` types (and `RepoHealth` if the route exposes it) | `vendor/shared` if returned by the API (the contract home), otherwise `domain/reviews/risk.ts` | Contract types are the innermost ring. Note the client has a separate copy of shared. |
| `SEVERITY_WEIGHT`, `weightOf`, `levelOf`, `worstLevel`, and a pure `scoreFindings` | `src/domain/reviews/risk.ts` | Pure rules, no I/O, no framework. Matches the existing `domain/reviews/latest-review.ts` and the `domain-is-pure` rule. |
| The security boost value | `platform/config.ts` (`RISK_SECURITY_BOOST` in `EnvSchema`, `z.coerce.number().default(1.5)`) | Env is read once at startup and validated. The service passes it into the pure function as a parameter. |
| Fetching findings and agents | `ReviewRepository` (already has `listFindingsForPull` and `listAgents`). Add a batch method such as `listFindingsForPulls(workspaceId, prIds)` | The repository is the only layer that touches Drizzle. Batching removes the N+1. |
| Orchestration (load, score, log, stamp time) | The `reviews` module `service.ts`, as `scorePulls(workspaceId, prIds)`. Optionally `repos` service calls it through an injected port | Use cases live in services. The service owns logging and the clock. |
| Repo health aggregation | `repos/service.ts`, with the counting and worst-level logic delegated to the domain function | The service orchestrates. It depends on a reviews service or port injected via the container, not on `new ReviewRepository(...)`. |

## Proposed code

`src/domain/reviews/risk.ts` (pure, imports nothing):

```ts
export type RiskLevel = 'low' | 'medium' | 'high';

export interface ScorableFinding { severity: string; agentName: string | null }

export interface RiskPolicy { securityBoost: number }

const SEVERITY_WEIGHT: Record<string, number> = { critical: 5, major: 3, minor: 1, info: 0 };
const ORDER: RiskLevel[] = ['low', 'medium', 'high'];

export function weightOf(f: ScorableFinding, policy: RiskPolicy): number {
  const base = SEVERITY_WEIGHT[f.severity] ?? 0;
  return f.agentName === 'security' ? base * policy.securityBoost : base;
}

export function levelOf(score: number): RiskLevel {
  if (score >= 7) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

export function scoreFindings(findings: ScorableFinding[], policy: RiskPolicy) {
  const total = findings.reduce((s, f) => s + weightOf(f, policy), 0);
  const score = Math.min(10, Math.round(total * 10) / 10);
  return { score, level: levelOf(score) };
}

export function worstLevel(levels: RiskLevel[]): RiskLevel | null {
  return levels.reduce<RiskLevel | null>(
    (acc, l) => (acc === null || ORDER.indexOf(l) > ORDER.indexOf(acc) ? l : acc),
    null,
  );
}
```

Config: add `RISK_SECURITY_BOOST: z.coerce.number().positive().default(1.5)` to `EnvSchema`, expose `riskSecurityBoost` on `AppConfig`.

`modules/reviews/service.ts` (application layer):

```ts
async scorePulls(workspaceId: string, prIds: string[]): Promise<RiskScore[]> {
  const [rows, agents] = await Promise.all([
    this.repo.listFindingsForPulls(workspaceId, prIds), // one batched query
    this.repo.listAgents(workspaceId),
  ]);
  const nameById = new Map(agents.map((a) => [a.id, a.name]));
  const policy = { securityBoost: this.container.config.riskSecurityBoost };
  const computedAt = new Date().toISOString(); // or an injected clock
  return prIds.map((prId) => {
    const fs = rows.filter((r) => r.prId === prId).map((r) => ({
      severity: r.finding.severity,
      agentName: nameById.get(r.agentId ?? '') ?? null,
    }));
    return { prId, ...scoreFindings(fs, policy), computedAt };
  });
}
```

`modules/repos/service.ts`: receive the reviews service (or a small `RiskScorer` port) via the constructor from the composition root. Remove `new ReviewRepository` and the import of `reviews/scoring.js`. In `health()`, call `scorePulls`, then `highRisk = scores.filter(s => s.level === 'high').length` and `worst = worstLevel(scores.map(s => s.level))`.

## How the tests become easy

```ts
import { weightOf, scoreFindings, levelOf, worstLevel } from '../../domain/reviews/risk.js';

it('boosts security findings', () => {
  expect(weightOf({ severity: 'major', agentName: 'security' }, { securityBoost: 2 })).toBe(6);
});
it('caps at 10', () => {
  const fs = Array(5).fill({ severity: 'critical', agentName: null });
  expect(scoreFindings(fs, { securityBoost: 1 })).toEqual({ score: 10, level: 'high' });
});
```

There is no DB, no env mutation, no logger and no fake clock. The orchestration only needs a repository double and the existing `ContainerOverrides` pattern, and the DB-backed part would go in a `*.it.test.ts`.

## Notes

- Check with `pnpm arch:check`. Do not add anything to the known-violations baseline. The current `repos -> reviews/scoring` plus the Fastify type import in a non-route file are the kind of thing that check catches.
- If `RepoHealth` or `RiskScore` is returned by a route, put the schema in `server/src/vendor/shared` and check `client/src/vendor/shared`, which has drifted.

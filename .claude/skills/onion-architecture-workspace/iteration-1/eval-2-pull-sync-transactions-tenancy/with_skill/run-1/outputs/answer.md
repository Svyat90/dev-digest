# Review: `modules/pull-sync`

Read first: `onion-architecture` SKILL (sections 5, 6, 11), `references/transactions.md`, `examples.md` (example 2, the same bug in `pulls`), and `server/.dependency-cruiser.cjs`.

## Root cause of the "PR with zero files"

`PullSyncService.sync` (service.ts:25-47) interleaves destructive writes with GitHub calls, outside any transaction:

```
deleteFiles -> listPullFiles (GitHub)   <- timeout here: files already deleted, nothing re-inserted
insertFiles -> deleteCommits -> listPullCommits (GitHub) -> insertCommits -> getPull (GitHub) -> updatePull
```

If `listPullFiles` times out, `pr_files` has already been wiped and the error propagates. The PR stays at zero files while `pull_requests.files_count` and `updated_at` still describe the old state. The same applies after the commits delete, and after a failure in `getPull`. Two violations of SKILL section 6 cause it:

1. No transaction. The server has no `db.transaction()`, so every delete-then-insert is non-atomic.
2. External calls are interleaved with the writes. The rule is to fetch first and open the transaction for the writes only, and never to call GitHub inside it.

Fix: fetch files, commits and head from GitHub first, with no DB writes. Then run `deleteFiles + insertFiles + deleteCommits + insertCommits + updatePull` in one `UnitOfWork.run`. A timeout then fails before anything is touched, and a DB failure rolls everything back.

## Other structural problems

| # | Where | Problem | Rule |
|---|---|---|---|
| 1 | repository.ts `getPull`, `listStale`, `openFindings` | Not scoped by `workspaceId`. `sync` loads the PR by id alone, so a PR from another workspace is found. Only the later `getRepo(workspaceId, pull.repoId)` check blocks it, by accident and with a misleading "Repository not found". `listStale` returns every workspace's PRs, so `syncStale(workspaceId)` loops over foreign PRs and then throws on the first one. `openFindings` returns any PR's findings. | SKILL 5, infrastructure: every repository read of a domain table takes `workspaceId`. The scope for a PR is the join to `repos`, and for findings the join to `reviews`, then `pull_requests`, then `repos`. |
| 2 | routes.ts:38-40 | `GET /pulls/:id/sync/findings` calls `getContext` and discards `workspaceId`. This is a tenancy leak: any caller reads another workspace's findings by PR id. | Presentation resolves tenancy and passes it on. |
| 3 | service.ts `syncStale` | One failing PR (a GitHub timeout is the very case QA hit) aborts the whole batch, and the count returned is `stale.length`, not the number actually synced. | The return value must mean what its name says. |
| 4 | service.ts:3,15 | The application ring imports `PullRow` from `db/rows`. It does not break the `application-does-not-know-the-orm` regex (`db/(schema\|client)`), but it leaks the row shape through the use case. The repository should return a contract or domain type. | SKILL 5, infrastructure: return contract types, not raw rows, when the value leaves the repository. |
| 5 | repository.ts `openFindings` | The name is wrong: it returns all findings, not only open ones. It also returns raw `FindingRow`s straight to the HTTP layer. | Naming, plus the same row-leak point as #4. |
| 6 | routes.ts:21-25 | The route does `new PullSyncRepository(container.db)` and wires the service itself. This is allowed (no import of `db/*`), but construction belongs on the composition side, and `uow` has to come from there. | SKILL 5, application: nothing is `new`-ed in the service. Wire it in the container or plugin. |
| 7 | service.ts `sync` | `return (await repo.getPull(prId))!` uses a non-null assertion. Return the updated row from the repository instead. | |

Not a problem: `PullSyncDeps` is already a narrow `Deps` object with `Pick<GitHubClient, ...>`, and `now` is injected. Keep both. The route does not touch Drizzle, and the service imports the repository only as a type.

No service is needed to forward calls here, but this one earns its place: it calls two ports (DB and GitHub) and has a transaction boundary.

## The fix

### 1. Port: `src/platform/unit-of-work.ts` (new)

```ts
declare const txBrand: unique symbol;

/** An open transaction. Opaque on purpose: only infrastructure can run queries on it. */
export type TxScope = { readonly [txBrand]: true };

export interface UnitOfWork {
  run<T>(work: (tx: TxScope) => Promise<T>): Promise<T>;
}
```

### 2. Drizzle implementation: `src/db/unit-of-work.ts` (new)

```ts
import type { Db } from './client.js';
import type { TxScope, UnitOfWork } from '../platform/unit-of-work.js';

type DrizzleTx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Executor = Db | DrizzleTx;

export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private db: Db) {}
  run<T>(work: (tx: TxScope) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(tx as unknown as TxScope));
  }
}

/** Repositories call this first: the open transaction if there is one, else the pool. */
export const executor = (db: Db, tx?: TxScope): Executor =>
  (tx as unknown as DrizzleTx | undefined) ?? db;
```

Composition root, `platform/container.ts` (only place that knows the concrete class):

```ts
private _uow?: UnitOfWork;
get uow(): UnitOfWork { return (this._uow ??= new DrizzleUnitOfWork(this.db)); }
// plus `uow?: UnitOfWork` in ContainerOverrides so tests can inject a fake
```

### 3. `modules/pull-sync/repository.ts`

All reads are workspace scoped. All writes take an optional `tx` and run every statement on it.

```ts
import { and, eq, lt } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { FindingRow, PullRow } from '../../db/rows.js';
import { executor } from '../../db/unit-of-work.js';
import type { TxScope } from '../../platform/unit-of-work.js';

export interface NewPrFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface NewPrCommit {
  sha: string;
  message: string;
  author: string;
  committedAt: Date | null;
}

export interface PullWithRepo {
  pull: PullRow;
  repo: { owner: string; name: string };
}

export type PullStatsPatch = Pick<PullRow, 'headSha' | 'additions' | 'deletions' | 'filesCount' | 'updatedAt'>;

export class PullSyncRepository {
  constructor(private db: Db) {}

  /** Tenancy: a PR belongs to a workspace through its repo. */
  async getPullWithRepo(workspaceId: string, prId: string): Promise<PullWithRepo | undefined> {
    const [row] = await this.db
      .select({ pull: t.pullRequests, owner: t.repos.owner, name: t.repos.name })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row && { pull: row.pull, repo: { owner: row.owner, name: row.name } };
  }

  async listStaleIds(workspaceId: string, olderThan: Date): Promise<string[]> {
    const rows = await this.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(and(eq(t.repos.workspaceId, workspaceId), lt(t.pullRequests.updatedAt, olderThan)));
    return rows.map((r) => r.id);
  }

  async listFindings(workspaceId: string, prId: string): Promise<FindingRow[]> {
    const rows = await this.db
      .select({ f: t.findings })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.reviews.prId))
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return rows.map((r) => r.f);
  }

  /** Delete + reinsert of one PR's files and commits, plus the stats update. Pass the same `tx` to every call. */
  async replaceFiles(prId: string, files: NewPrFile[], tx?: TxScope): Promise<void> {
    const q = executor(this.db, tx);
    await q.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
    if (files.length > 0) await q.insert(t.prFiles).values(files.map((f) => ({ prId, ...f })));
  }

  async replaceCommits(prId: string, commits: NewPrCommit[], tx?: TxScope): Promise<void> {
    const q = executor(this.db, tx);
    await q.delete(t.prCommits).where(eq(t.prCommits.prId, prId));
    if (commits.length > 0) await q.insert(t.prCommits).values(commits.map((c) => ({ prId, ...c })));
  }

  async updateStats(prId: string, patch: PullStatsPatch, tx?: TxScope): Promise<PullRow> {
    const [row] = await executor(this.db, tx)
      .update(t.pullRequests)
      .set(patch)
      .where(eq(t.pullRequests.id, prId))
      .returning();
    return row;
  }
}
```

(The old `getPull`, `getRepo`, `listStale`, `openFindings`, `deleteFiles`, `insertFiles`, `deleteCommits`, `insertCommits` and `updatePull` are removed. Delete and insert now live in one method per table, so nobody can call one without the other.)

### 4. `modules/pull-sync/service.ts`

```ts
import type { GitHubClient } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type { UnitOfWork } from '../../platform/unit-of-work.js';
import type { PullSyncRepository } from './repository.js';

export interface PullSyncDeps {
  repo: Pick<
    PullSyncRepository,
    'getPullWithRepo' | 'listStaleIds' | 'listFindings' | 'replaceFiles' | 'replaceCommits' | 'updateStats'
  >;
  github: () => Promise<Pick<GitHubClient, 'getPull' | 'listPullFiles' | 'listPullCommits'>>;
  uow: UnitOfWork;
  now: () => Date;
  log: { warn(obj: object, msg: string): void };
}

export class PullSyncService {
  constructor(private deps: PullSyncDeps) {}

  async sync(workspaceId: string, prId: string) {
    const { repo, uow } = this.deps;
    const found = await repo.getPullWithRepo(workspaceId, prId); // workspace-scoped
    if (!found) throw new NotFoundError('Pull request not found');
    const { pull, repo: ref } = found;

    // 1. Everything external FIRST. A GitHub timeout here throws before any write,
    //    so the persisted files and commits stay exactly as they were.
    const gh = await this.deps.github();
    const [files, commits, remote] = await Promise.all([
      gh.listPullFiles(ref, pull.number),
      gh.listPullCommits(ref, pull.number),
      gh.getPull(ref, pull.number),
    ]);

    // 2. Writes only, all-or-nothing. No external call inside the transaction.
    return uow.run(async (tx) => {
      await repo.replaceFiles(
        prId,
        files.map((f) => ({
          path: f.filename,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        tx,
      );
      await repo.replaceCommits(
        prId,
        commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          committedAt: c.date ? new Date(c.date) : null,
        })),
        tx,
      );
      return repo.updateStats(
        prId,
        {
          headSha: remote.headSha,
          additions: remote.additions,
          deletions: remote.deletions,
          filesCount: files.length,
          updatedAt: this.deps.now(),
        },
        tx,
      );
    });
  }

  /** Best effort per PR: one failure must not abort the batch. Sequential on purpose (GitHub rate limits). */
  async syncStale(workspaceId: string, maxAgeMinutes: number): Promise<{ synced: number; failed: number }> {
    const cutoff = new Date(this.deps.now().getTime() - maxAgeMinutes * 60_000);
    const ids = await this.deps.repo.listStaleIds(workspaceId, cutoff);
    let synced = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await this.sync(workspaceId, id);
        synced++;
      } catch (err) {
        failed++;
        this.deps.log.warn({ err, prId: id }, 'pull sync failed; PR left unchanged');
      }
    }
    return { synced, failed };
  }

  findingsFor(workspaceId: string, prId: string) {
    return this.deps.repo.listFindings(workspaceId, prId);
  }
}
```

If the three GitHub calls should not fan out in parallel (rate limits), keep them sequential. The only requirement is that they all finish before `uow.run`.

### 5. `modules/pull-sync/routes.ts`

```ts
const service = new PullSyncService({
  repo: new PullSyncRepository(container.db), // better: container.pullSyncRepo once it exists
  github: () => container.github(),
  uow: container.uow,
  now: () => new Date(),
  log: app.log,
});

app.post('/pulls/:id/sync', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  return service.sync(workspaceId, req.params.id);
});

app.post('/pulls/sync-stale', { schema: { body: SyncStaleBody } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  return service.syncStale(workspaceId, req.body.maxAgeMinutes); // { synced, failed }
});

app.get('/pulls/:id/sync/findings', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req); // was discarded
  return service.findingsFor(workspaceId, req.params.id);
});
```

The `/pulls/sync-stale` response gains `failed`. Check the client before changing a shape (the client contract copy has drifted).

## Tests

- Application unit test (no DB): fake `github`, fake `uow` with `run: (w) => w({} as TxScope)`, and a fake repo.
  - `listPullFiles` rejects: `sync` rejects and none of `replaceFiles`, `replaceCommits` or `updateStats` was called (this is the QA regression).
  - Success: all three write calls receive the same `tx`.
  - `syncStale` with one rejecting PR returns `{ synced: n-1, failed: 1 }`.
  - Unknown id returns `NotFoundError`.
- `pull-sync/repository.it.test.ts` against Postgres:
  - Make `replaceCommits` fail inside `uow.run` and assert `pr_files` is unchanged (atomicity).
  - Workspace B cannot `getPullWithRepo`, `listStaleIds` or `listFindings` workspace A's PR.
- Run `pnpm arch:check && pnpm typecheck && pnpm test` in `server/`. The baseline must not grow, and no new `application-does-not-know-the-orm` hit is expected, since the service imports no `db/*`.

## Order of moves (each leaves arch:check green)

1. Add `UnitOfWork`, `DrizzleUnitOfWork` and the container getter (no behaviour change).
2. Repository: scoped reads plus `replace*` and `updateStats(tx)`.
3. Service rewrite (fetch first, then `uow.run`), with the unit test.
4. Route: pass `workspaceId` to `findingsFor`, inject `uow` and `log`.
5. The `pulls` module has the same bug (`references/examples.md`, example 2). Reuse the same `UnitOfWork` there as a separate change.

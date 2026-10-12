# Review: `modules/pull-sync`

## Root cause of the "PR with zero files"

`PullSyncService.sync` does destructive work **before** the network work, and without a transaction:

```
deleteFiles(prId)                 // committed immediately
gh.listPullFiles(...)             // <- GitHub timeout throws here
insertFiles(...)                  // never reached
```

Every repository method runs as its own auto-committed statement on `this.db`. If GitHub times out after `deleteFiles` (or after `deleteCommits`), the old rows are already gone and nothing replaces them. The PR keeps its old `files_count` and `updated_at`, so it also still looks fresh. The UI shows zero files, and `syncStale` will not retry it soon.

The same problem exists between steps. A failure in `listPullCommits` or `getPull` leaves new files with old commits and an old head SHA. The sequence has three writes and one metadata update with no atomicity.

The project already has the pattern for this: `AgentsRepository.setSkills` (`server/src/modules/agents/repository.ts`) uses `this.db.transaction(async (tx) => ...)` and runs every statement on `tx`. INSIGHTS (2026-09-22) says to copy that shape.

### Fix
1. Do all GitHub I/O first (`getPull`, `listPullFiles`, `listPullCommits`) and hold the results in memory. A timeout then changes nothing.
2. Write everything in one repository method, `replaceSnapshot`, inside a single `db.transaction`. It deletes files, inserts files, deletes commits, inserts commits and updates the PR row. The service must not call separate delete and insert methods.
3. Never hold a DB transaction open across a network call.

## Other structural problems

1. **Tenancy is not enforced (breaks the "every query scopes by workspace_id" rule in server/CLAUDE.md).**
   - `getPull(prId)` has no workspace filter. `sync` checks the workspace only through the repo lookup. Scope the PR query directly: `pull_requests.workspace_id = ws AND id = ?`.
   - `listStale(olderThan)` is global. `POST /pulls/sync-stale` then syncs every workspace's PRs, which is a cross-tenant leak and write. The service passes `workspaceId` to `sync`, which then 404s halfway through the loop for foreign PRs.
   - `GET /pulls/:id/sync/findings` discards the workspace (`await getContext(...)` with no result used). Anyone can read any PR's findings by id. `openFindings` also joins reviews without a workspace filter.
   - `updatePull`, `deleteFiles`, `deleteCommits` and similar take a bare `prId`. Once `getPull` is scoped that is acceptable, but `updatePull` should also filter by workspace.
2. **`syncStale` is fragile.** One failing PR (timeout) aborts the whole batch with a 500, and the return value is `stale.length` instead of the number actually synced. It also runs sequentially and unbounded (add a `limit`). `lt(updatedAt, cutoff)` skips rows where `updated_at IS NULL` (the column is nullable), so never-synced PRs are never "stale". Catch per PR, count successes, and return the failures.
3. **Concurrency.** Two simultaneous syncs of one PR interleave deletes and inserts. Taking a row lock (`select ... for update` on the PR inside the transaction) or a per-PR advisory lock serialises them. The transaction in the fix makes the interleaving safe at the statement level, but the last writer would still win with older data. Locking is cheap insurance.
4. **Naming and API shape.** `openFindings` returns all findings, not open ones. `/pulls/:id/sync/findings` is not a sync operation and duplicates what `pulls/routes.ts` already serves. Drop it from this module, or move it to the pulls/reviews module. `repo.ts`/`PullRow` are fine; the `(await repo.getPull(prId))!` non-null assertion can be removed because `replaceSnapshot` returns the updated row.
5. **Service/repo boundary.** The service imports `GitHubClient` from `@devdigest/shared` (a port, fine) and uses an injected clock (good). But the repository has too fine a grain (delete/insert primitives) and so pushes transactional responsibility into the service, which cannot own a transaction without importing drizzle. The fix keeps the service free of drizzle and keeps the transaction in the repository.
6. **Overlap.** `pulls/routes.ts` already upserts PR rows and files. Two modules now write `pr_files`, with different semantics. Long term, one owner of those tables should expose the snapshot write.
7. **Tests.** Add `pull-sync.it.test.ts` (DB-backed, so the suffix matters): inject a github double whose `listPullFiles` rejects and assert the old files, commits and headSha are untouched. Also assert that `sync-stale` ignores another workspace's PRs.

## Concrete fix

### `repository.ts`

```ts
import { and, eq, lt, or, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { FindingRow, PullRow } from '../../db/rows.js';

export interface NewPrFile { path: string; additions: number; deletions: number; patch: string | null }
export interface NewPrCommit { sha: string; message: string; author: string; committedAt: Date | null }
export interface PullSnapshot {
  headSha: string;
  additions: number;
  deletions: number;
  files: NewPrFile[];
  commits: NewPrCommit[];
  syncedAt: Date;
}

export class PullSyncRepository {
  constructor(private db: Db) {}

  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async getRepo(workspaceId: string, repoId: string) {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** Workspace-scoped; includes PRs that were never synced (updated_at IS NULL). */
  async listStale(workspaceId: string, olderThan: Date, limit: number): Promise<PullRow[]> {
    return this.db
      .select()
      .from(t.pullRequests)
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          or(isNull(t.pullRequests.updatedAt), lt(t.pullRequests.updatedAt, olderThan)),
        ),
      )
      .limit(limit);
  }

  async findingsForPull(workspaceId: string, prId: string): Promise<FindingRow[]> {
    const rows = await this.db
      .select({ f: t.findings })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.prId, prId)));
    return rows.map((r) => r.f);
  }

  /**
   * Replace files, commits and PR totals atomically. Every statement uses `tx`.
   * Callers must fetch from GitHub BEFORE calling this: no network I/O inside.
   */
  async replaceSnapshot(workspaceId: string, prId: string, s: PullSnapshot): Promise<PullRow> {
    return this.db.transaction(async (tx) => {
      // Serialise concurrent syncs of the same PR and re-check tenancy.
      const [locked] = await tx
        .select({ id: t.pullRequests.id })
        .from(t.pullRequests)
        .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)))
        .for('update');
      if (!locked) throw new Error('Pull request disappeared during sync');

      await tx.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
      if (s.files.length) {
        await tx.insert(t.prFiles).values(s.files.map((f) => ({ prId, ...f })));
      }
      await tx.delete(t.prCommits).where(eq(t.prCommits.prId, prId));
      if (s.commits.length) {
        await tx.insert(t.prCommits).values(s.commits.map((c) => ({ prId, ...c })));
      }
      const [row] = await tx
        .update(t.pullRequests)
        .set({
          headSha: s.headSha,
          additions: s.additions,
          deletions: s.deletions,
          filesCount: s.files.length,
          updatedAt: s.syncedAt,
        })
        .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)))
        .returning();
      return row!;
    });
  }
}
```

(Replace the `NotFoundError` thrown inside the transaction with the project's error type if preferred; any throw rolls the transaction back.)

### `service.ts`

```ts
import type { GitHubClient } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type { PullRow } from '../../db/rows.js';
import type { PullSyncRepository } from './repository.js';

export interface PullSyncDeps {
  repo: PullSyncRepository;
  github: () => Promise<Pick<GitHubClient, 'getPull' | 'listPullFiles' | 'listPullCommits'>>;
  now: () => Date;
}

const STALE_BATCH_LIMIT = 50;

export class PullSyncService {
  constructor(private deps: PullSyncDeps) {}

  async sync(workspaceId: string, prId: string): Promise<PullRow> {
    const { repo } = this.deps;
    const pull = await repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repoRow = await repo.getRepo(workspaceId, pull.repoId);
    if (!repoRow) throw new NotFoundError('Repository not found');

    // 1. All network I/O first. A timeout here leaves the DB untouched.
    const gh = await this.deps.github();
    const ref = { owner: repoRow.owner, name: repoRow.name };
    const [files, commits, remote] = await Promise.all([
      gh.listPullFiles(ref, pull.number),
      gh.listPullCommits(ref, pull.number),
      gh.getPull(ref, pull.number),
    ]);

    // 2. One atomic write.
    return repo.replaceSnapshot(workspaceId, prId, {
      headSha: remote.headSha,
      additions: remote.additions,
      deletions: remote.deletions,
      syncedAt: this.deps.now(),
      files: files.map((f) => ({
        path: f.filename,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
      })),
      commits: commits.map((c) => ({
        sha: c.sha,
        message: c.message,
        author: c.author,
        committedAt: c.date ? new Date(c.date) : null,
      })),
    });
  }

  async syncStale(workspaceId: string, maxAgeMinutes: number) {
    const cutoff = new Date(this.deps.now().getTime() - maxAgeMinutes * 60_000);
    const stale = await this.deps.repo.listStale(workspaceId, cutoff, STALE_BATCH_LIMIT);
    let synced = 0;
    const failed: string[] = [];
    for (const p of stale) {
      try {
        await this.sync(workspaceId, p.id);
        synced++;
      } catch {
        failed.push(p.id); // one bad PR must not abort the batch
      }
    }
    return { synced, failed };
  }

  async findingsFor(workspaceId: string, prId: string) {
    if (!(await this.deps.repo.getPull(workspaceId, prId))) {
      throw new NotFoundError('Pull request not found');
    }
    return this.deps.repo.findingsForPull(workspaceId, prId);
  }
}
```

### `routes.ts` changes

```ts
app.post('/pulls/sync-stale', { schema: { body: SyncStaleBody } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  return service.syncStale(workspaceId, req.body.maxAgeMinutes); // { synced, failed }
});

app.get('/pulls/:id/sync/findings', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);   // was discarded before
  return service.findingsFor(workspaceId, req.params.id);
});
```

Note: `reviews.workspaceId` exists (schema/reviews.ts); confirm the column name when applying. Check that `Db` exposes `.transaction` and `.for('update')` on the installed Drizzle 0.38 (it does for postgres-js).

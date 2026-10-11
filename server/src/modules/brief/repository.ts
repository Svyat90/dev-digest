import { and, eq } from 'drizzle-orm';
import { PrBrief } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PullRow } from '../../db/rows.js';

/**
 * Brief data-access. Owns `pr_brief`, which has no `workspace_id` (like
 * `findings`): `listFiles`, `get` and `upsert` are keyed by PR id alone, so
 * call them only after `getPull` proved the PR belongs to the workspace.
 */

export type RepoRow = typeof t.repos.$inferSelect;

export interface BriefFileRow {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export class BriefRepository {
  constructor(private db: Db) {}

  /** Workspace-scoped PR lookup. */
  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /** Workspace-scoped repo lookup. */
  async getRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** Changed files with patches. Call only after `getPull` proved the workspace. */
  async listFiles(prId: string): Promise<BriefFileRow[]> {
    return this.db
      .select({
        path: t.prFiles.path,
        additions: t.prFiles.additions,
        deletions: t.prFiles.deletions,
        patch: t.prFiles.patch,
      })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
  }

  /** Stored brief, or `null` when none exists or the row no longer matches the contract. Call only after `getPull`. */
  async get(prId: string): Promise<PrBrief | null> {
    const [row] = await this.db
      .select({ json: t.prBrief.json })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId));
    if (!row) return null;
    const parsed = PrBrief.safeParse(row.json);
    return parsed.success ? parsed.data : null;
  }

  /** One statement (insert-or-update on the `pr_id` PK), so no transaction is needed. Call only after `getPull`. */
  async upsert(prId: string, brief: PrBrief): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json: brief })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: brief } });
  }
}

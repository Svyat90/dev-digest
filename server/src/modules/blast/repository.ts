import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Blast-radius data-access. Owns no table — reads `pull_requests`, `pr_files`
 * and `repos` (repo-intel's own tables are reached through its facade).
 */

export interface BlastPullRow {
  id: string;
  repoId: string;
  number: number;
}

export interface BlastFileRow {
  path: string;
  additions: number;
  deletions: number;
}

export interface BlastRepoRow {
  owner: string;
  name: string;
  clonePath: string | null;
}

export class BlastRepository {
  constructor(private db: Db) {}

  /** Workspace-scoped PR lookup (BR10). */
  async getPull(workspaceId: string, prId: string): Promise<BlastPullRow | undefined> {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
        repoId: t.pullRequests.repoId,
        number: t.pullRequests.number,
      })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /**
   * Changed files of a PR. `pr_files` has no `workspace_id` of its own — call
   * this only after `getPull` proved the workspace.
   */
  async listChangedFiles(prId: string): Promise<BlastFileRow[]> {
    return this.db
      .select({
        path: t.prFiles.path,
        additions: t.prFiles.additions,
        deletions: t.prFiles.deletions,
      })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
  }

  /** Workspace-scoped repo lookup. */
  async getRepo(workspaceId: string, repoId: string): Promise<BlastRepoRow | undefined> {
    const [row] = await this.db
      .select({ owner: t.repos.owner, name: t.repos.name, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }
}

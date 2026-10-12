import { and, eq, lt, ne } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export interface StalePull {
  id: string;
  repoId: string;
  number: number;
  title: string;
  author: string;
}

export class RemindersRepository {
  constructor(private db: Db) {}

  async listStalePulls(workspaceId: string, olderThan: Date): Promise<StalePull[]> {
    return this.db
      .select({
        id: t.pullRequests.id,
        repoId: t.pullRequests.repoId,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        author: t.pullRequests.author,
      })
      .from(t.pullRequests)
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          ne(t.pullRequests.status, 'merged'),
          lt(t.pullRequests.updatedAt, olderThan),
        ),
      );
  }

  async getRepo(workspaceId: string, repoId: string) {
    const [row] = await this.db
      .select({ owner: t.repos.owner, name: t.repos.name })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async countFindings(workspaceId: string, prId: string): Promise<number> {
    const rows = await this.db
      .select({ id: t.findings.id })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.prId, prId)));
    return rows.length;
  }
}

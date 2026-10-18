import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PullRow } from '../../db/rows.js';

type DigestRow = typeof t.digests.$inferSelect;

export class DigestPublishRepository {
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
      .select({ owner: t.repos.owner, name: t.repos.name })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async insert(workspaceId: string, input: { bodyMd: string; deliveredTo: string }): Promise<DigestRow> {
    const [row] = await this.db
      .insert(t.digests)
      .values({ workspaceId, periodStart: new Date(), bodyMd: input.bodyMd, deliveredTo: input.deliveredTo })
      .returning();
    return row!;
  }

  async finish(workspaceId: string, id: string): Promise<DigestRow> {
    const [row] = await this.db
      .update(t.digests)
      .set({ periodEnd: new Date() })
      .where(and(eq(t.digests.workspaceId, workspaceId), eq(t.digests.id, id)))
      .returning();
    return row!;
  }
}

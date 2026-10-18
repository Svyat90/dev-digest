import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { executor } from '../../db/unit-of-work.js';
import type { TxScope } from '../../platform/unit-of-work.js';

export interface PublicationDto {
  id: string;
  prId: string;
  status: 'pending' | 'sent';
  reviewId: string | null;
}

type Row = typeof t.publications.$inferSelect;
const toDto = (r: Row): PublicationDto => ({
  id: r.id,
  prId: r.prId,
  status: r.status as 'pending' | 'sent',
  reviewId: r.reviewId,
});

export class PublishRepository {
  constructor(private db: Db) {}

  async getPull(workspaceId: string, prId: string) {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        owner: t.repos.owner,
        name: t.repos.name,
      })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async insertPending(workspaceId: string, prId: string, body: string, tx?: TxScope) {
    const [row] = await executor(this.db, tx)
      .insert(t.publications)
      .values({ workspaceId, prId, body, status: 'pending' })
      .returning();
    return toDto(row!);
  }

  async markSent(workspaceId: string, id: string, reviewId: string, tx?: TxScope) {
    const [row] = await executor(this.db, tx)
      .update(t.publications)
      .set({ status: 'sent', reviewId })
      .where(and(eq(t.publications.workspaceId, workspaceId), eq(t.publications.id, id)))
      .returning();
    return toDto(row!);
  }

  async listPending(workspaceId: string) {
    const rows = await this.db
      .select()
      .from(t.publications)
      .where(and(eq(t.publications.workspaceId, workspaceId), eq(t.publications.status, 'pending')));
    return rows.map((r) => ({ ...toDto(r), body: r.body }));
  }
}

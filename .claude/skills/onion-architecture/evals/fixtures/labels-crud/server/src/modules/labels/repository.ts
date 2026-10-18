import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export interface Label {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

type LabelRow = typeof t.labels.$inferSelect;

const toLabel = (r: LabelRow): Label => ({
  id: r.id,
  name: r.name,
  color: r.color,
  createdAt: r.createdAt.toISOString(),
});

export class LabelsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<Label[]> {
    const rows = await this.db
      .select()
      .from(t.labels)
      .where(eq(t.labels.workspaceId, workspaceId))
      .orderBy(asc(t.labels.name));
    return rows.map(toLabel);
  }

  async create(workspaceId: string, input: { name: string; color: string }): Promise<Label> {
    const [row] = await this.db
      .insert(t.labels)
      .values({ workspaceId, ...input })
      .onConflictDoUpdate({
        target: [t.labels.workspaceId, t.labels.name],
        set: { color: input.color },
      })
      .returning();
    return toLabel(row!);
  }

  async rename(
    workspaceId: string,
    id: string,
    patch: { name?: string; color?: string },
  ): Promise<Label | null> {
    const [row] = await this.db
      .update(t.labels)
      .set(patch)
      .where(and(eq(t.labels.workspaceId, workspaceId), eq(t.labels.id, id)))
      .returning();
    return row ? toLabel(row) : null;
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.labels)
      .where(and(eq(t.labels.workspaceId, workspaceId), eq(t.labels.id, id)))
      .returning({ id: t.labels.id });
    return rows.length > 0;
  }
}

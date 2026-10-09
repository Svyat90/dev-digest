import { and, eq, gte, lt, sum } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export class CostReportRepository {
  constructor(private db: Db) {}

  async listAgents(workspaceId: string) {
    return this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId));
  }

  async costForDay(workspaceId: string, agentId: string, day: Date): Promise<number> {
    const next = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    const [row] = await this.db
      .select({ total: sum(t.agentRuns.costUsd) })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.agentId, agentId),
          gte(t.agentRuns.ranAt, day),
          lt(t.agentRuns.ranAt, next),
        ),
      );
    return Number(row?.total ?? 0);
  }
}

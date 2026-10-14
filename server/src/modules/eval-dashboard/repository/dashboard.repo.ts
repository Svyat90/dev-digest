import { and, asc, count, desc, eq, gte } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type {
  AgentEvalRunSummary,
  EvalTrendPoint,
  EvalWorkspaceRun,
  Provider,
} from '@devdigest/shared';
import { toRunSummary } from '../helpers.js';
import type { DashboardAgentRow, RecallSample, StoredRun } from '../types.js';

/**
 * SPEC-05 — workspace-scoped reads for the Eval Dashboard pages. Every method
 * filters on `workspace_id`; per-agent methods also filter on `agent_id`.
 * One query per method — never one per agent.
 */
export class EvalDashboardRepository {
  constructor(private readonly db: Db) {}

  private toAgentRow(r: {
    id: string;
    name: string;
    provider: Provider;
    model: string;
    enabled: boolean;
  }): DashboardAgentRow {
    return { id: r.id, name: r.name, provider: r.provider, model: r.model, enabled: r.enabled };
  }

  async listAgents(workspaceId: string): Promise<DashboardAgentRow[]> {
    const rows = await this.db
      .select({
        id: t.agents.id,
        name: t.agents.name,
        provider: t.agents.provider,
        model: t.agents.model,
        enabled: t.agents.enabled,
      })
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(asc(t.agents.name));
    return rows.map((r) => this.toAgentRow(r));
  }

  /** Eval cases per agent — one grouped count. `count()` is already a number. */
  async caseCounts(workspaceId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ agentId: t.evalCases.agentId, n: count() })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')))
      .groupBy(t.evalCases.agentId);
    const out = new Map<string, number>();
    for (const r of rows) if (r.agentId) out.set(r.agentId, r.n);
    return out;
  }

  async runningRuns(workspaceId: string): Promise<Map<string, AgentEvalRunSummary>> {
    const rows = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.evalSuiteRuns.status, 'running')));
    return new Map(rows.map((r) => [r.agentId, toRunSummary(r)]));
  }

  async latestCompletedPerAgent(workspaceId: string): Promise<Map<string, AgentEvalRunSummary>> {
    const rows = await this.db
      .selectDistinctOn([t.evalSuiteRuns.agentId])
      .from(t.evalSuiteRuns)
      .where(and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.evalSuiteRuns.status, 'completed')))
      .orderBy(t.evalSuiteRuns.agentId, desc(t.evalSuiteRuns.startedAt));
    return new Map(rows.map((r) => [r.agentId, toRunSummary(r)]));
  }

  async recallSamplesSince(workspaceId: string, since: Date): Promise<RecallSample[]> {
    const rows = await this.db
      .select({
        agentId: t.evalSuiteRuns.agentId,
        startedAt: t.evalSuiteRuns.startedAt,
        recall: t.evalSuiteRuns.recall,
      })
      .from(t.evalSuiteRuns)
      .where(
        and(
          eq(t.evalSuiteRuns.workspaceId, workspaceId),
          eq(t.evalSuiteRuns.status, 'completed'),
          gte(t.evalSuiteRuns.startedAt, since),
        ),
      )
      .orderBy(asc(t.evalSuiteRuns.startedAt));
    return rows;
  }

  async recentRuns(workspaceId: string, limit: number): Promise<EvalWorkspaceRun[]> {
    const rows = await this.db
      .select({ run: t.evalSuiteRuns, agentName: t.agents.name })
      .from(t.evalSuiteRuns)
      .innerJoin(t.agents, eq(t.agents.id, t.evalSuiteRuns.agentId))
      .where(and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.agents.workspaceId, workspaceId)))
      .orderBy(desc(t.evalSuiteRuns.startedAt))
      .limit(limit);
    return rows.map((r) => ({ ...toRunSummary(r.run), agent_name: r.agentName }));
  }

  async agentRow(workspaceId: string, agentId: string): Promise<DashboardAgentRow | undefined> {
    const [row] = await this.db
      .select({
        id: t.agents.id,
        name: t.agents.name,
        provider: t.agents.provider,
        model: t.agents.model,
        enabled: t.agents.enabled,
      })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)));
    return row ? this.toAgentRow(row) : undefined;
  }

  async caseCount(workspaceId: string, agentId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.agentId, agentId),
        ),
      );
    return row?.n ?? 0;
  }

  async lastCompletedRuns(
    workspaceId: string,
    agentId: string,
    limit: number,
  ): Promise<StoredRun[]> {
    const rows = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(
        and(
          eq(t.evalSuiteRuns.workspaceId, workspaceId),
          eq(t.evalSuiteRuns.agentId, agentId),
          eq(t.evalSuiteRuns.status, 'completed'),
        ),
      )
      .orderBy(desc(t.evalSuiteRuns.startedAt))
      .limit(limit);
    return rows.map((r) => ({ ...toRunSummary(r), config: r.config, cases: r.cases }));
  }

  async runningRun(
    workspaceId: string,
    agentId: string,
  ): Promise<AgentEvalRunSummary | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(
        and(
          eq(t.evalSuiteRuns.workspaceId, workspaceId),
          eq(t.evalSuiteRuns.agentId, agentId),
          eq(t.evalSuiteRuns.status, 'running'),
        ),
      );
    return row ? toRunSummary(row) : undefined;
  }

  async runsSince(
    workspaceId: string,
    agentId: string,
    since: Date | null,
  ): Promise<AgentEvalRunSummary[]> {
    const rows = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(this.agentScope(workspaceId, agentId, since))
      .orderBy(desc(t.evalSuiteRuns.startedAt));
    return rows.map(toRunSummary);
  }

  async completedPointsSince(
    workspaceId: string,
    agentId: string,
    since: Date | null,
    limit: number,
  ): Promise<EvalTrendPoint[]> {
    const rows = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(and(this.agentScope(workspaceId, agentId, since), eq(t.evalSuiteRuns.status, 'completed')))
      .orderBy(desc(t.evalSuiteRuns.startedAt))
      .limit(limit);
    return rows.map((r) => ({
      run_id: r.id,
      started_at: r.startedAt.toISOString(),
      agent_version: r.agentVersion,
      recall: r.recall,
      precision: r.precision,
      citation_accuracy: r.citationAccuracy,
      cost_usd: r.costUsd,
    }));
  }

  private agentScope(workspaceId: string, agentId: string, since: Date | null): SQL | undefined {
    return and(
      eq(t.evalSuiteRuns.workspaceId, workspaceId),
      eq(t.evalSuiteRuns.agentId, agentId),
      since ? gte(t.evalSuiteRuns.startedAt, since) : undefined,
    );
  }
}

import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { AgentVersionConfig, EvalRunCaseRef, EvalRunConfig } from '@devdigest/shared';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import { isAgentRunRow } from '../../../domain/evals/run-owner.js';
import { toRunSummary } from '../helpers.js';
import type {
  CurrentAgentConfig,
  PromotionResult,
  PromotionWrite,
  SkillSnapshot,
  StoredRun,
} from '../types.js';

/**
 * Promotion data-access: stored runs, skill bodies by version, the agent's
 * current configuration, and the one-transaction Promote write. Every read is
 * workspace-scoped; runs are additionally scoped by agent.
 */
export class EvalPromotionRepository {
  constructor(private readonly db: Db) {}

  /** A run of this agent in this workspace; another agent's or workspace's run is `undefined`. */
  async storedRun(
    workspaceId: string,
    agentId: string,
    runId: string,
  ): Promise<StoredRun | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(
        and(
          eq(t.evalSuiteRuns.workspaceId, workspaceId),
          isNotNull(t.evalSuiteRuns.agentId),
          eq(t.evalSuiteRuns.agentId, agentId),
          eq(t.evalSuiteRuns.id, runId),
        ),
      );
    if (!row || !isAgentRunRow(row)) return undefined;
    return {
      ...toRunSummary(row),
      config: row.config as EvalRunConfig,
      cases: row.cases as EvalRunCaseRef[],
    };
  }

  /** `skillId -> version -> body` for the requested pairs, in one workspace-scoped query. */
  async skillVersionBodies(
    workspaceId: string,
    refs: readonly { skillId: string; version: number }[],
  ): Promise<Map<string, Map<number, string>>> {
    const out = new Map<string, Map<number, string>>();
    if (refs.length === 0) return out;
    const wanted = new Set(refs.map((r) => `${r.skillId}:${r.version}`));
    const rows = await this.db
      .select({
        skillId: t.skillVersions.skillId,
        version: t.skillVersions.version,
        body: t.skillVersions.body,
      })
      .from(t.skillVersions)
      .innerJoin(t.skills, eq(t.skills.id, t.skillVersions.skillId))
      .where(
        and(
          eq(t.skills.workspaceId, workspaceId),
          inArray(t.skillVersions.skillId, [...new Set(refs.map((r) => r.skillId))]),
        ),
      );
    for (const r of rows) {
      if (!wanted.has(`${r.skillId}:${r.version}`)) continue;
      let byVersion = out.get(r.skillId);
      if (!byVersion) {
        byVersion = new Map();
        out.set(r.skillId, byVersion);
      }
      byVersion.set(r.version, r.body);
    }
    return out;
  }

  /** The agent's current configuration with its links in order, or `undefined`. */
  async currentAgentConfig(
    workspaceId: string,
    agentId: string,
  ): Promise<CurrentAgentConfig | undefined> {
    const [agent] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)));
    if (!agent) return undefined;
    const links = await this.db
      .select({ skillId: t.agentSkills.skillId, enabled: t.agentSkills.enabled })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return {
      id: agent.id,
      name: agent.name,
      version: agent.version,
      provider: agent.provider,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      strategy: agent.strategy,
      outputSchema: agent.outputSchema,
      ciFailOn: agent.ciFailOn,
      repoIntel: agent.repoIntel,
      links,
    };
  }

  async skillsByIds(workspaceId: string, skillIds: readonly string[]): Promise<SkillSnapshot[]> {
    if (skillIds.length === 0) return [];
    return this.db
      .select({
        id: t.skills.id,
        name: t.skills.name,
        body: t.skills.body,
        version: t.skills.version,
      })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), inArray(t.skills.id, [...skillIds])));
  }

  /** Distinct other agents linking any of the skills (any link state), ordered by name. */
  async otherAgentsLinking(
    workspaceId: string,
    agentId: string,
    skillIds: readonly string[],
  ): Promise<{ id: string; name: string }[]> {
    if (skillIds.length === 0) return [];
    const rows = await this.db
      .selectDistinct({ id: t.agents.id, name: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          inArray(t.agentSkills.skillId, [...skillIds]),
          sql`${t.agents.id} <> ${agentId}`,
        ),
      )
      .orderBy(asc(t.agents.name));
    return rows;
  }

  /**
   * Restore skill bodies and replace the agent's configuration and links as ONE
   * transaction. No conflict is swallowed: a version-key conflict
   * throws and rolls everything back.
   */
  async applyPromotion(workspaceId: string, write: PromotionWrite): Promise<PromotionResult> {
    return this.db.transaction(async (tx) => {
      const restored: { skillId: string; version: number }[] = [];
      for (const item of write.restore) {
        const [skill] = await tx
          .update(t.skills)
          .set({ body: item.body, version: sql`${t.skills.version} + 1` })
          .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, item.skillId)))
          .returning({ version: t.skills.version });
        if (!skill) throw new Error('Skill not found during promotion');
        await tx.insert(t.skillVersions).values({
          skillId: item.skillId,
          version: skill.version,
          body: item.body,
          note: item.note,
        });
        restored.push({ skillId: item.skillId, version: skill.version });
      }

      const [agent] = await tx
        .update(t.agents)
        .set({
          provider: write.provider,
          model: write.model,
          systemPrompt: write.systemPrompt,
          strategy: write.strategy,
          version: sql`${t.agents.version} + 1`,
        })
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, write.agentId)))
        .returning();
      if (!agent) throw new Error('Agent not found during promotion');

      await tx.delete(t.agentSkills).where(eq(t.agentSkills.agentId, write.agentId));
      if (write.links.length > 0) {
        await tx.insert(t.agentSkills).values(
          write.links.map((l, i) => ({
            agentId: write.agentId,
            skillId: l.skillId,
            order: i,
            enabled: l.enabled,
          })),
        );
      }

      const configJson = {
        provider: agent.provider,
        model: agent.model,
        system_prompt: agent.systemPrompt,
        output_schema: agent.outputSchema,
        strategy: agent.strategy,
        ci_fail_on: agent.ciFailOn,
        repo_intel: agent.repoIntel,
        skills: write.links.map((l) => l.skillId),
      } satisfies AgentVersionConfig;
      await tx.insert(t.agentVersions).values({
        agentId: write.agentId,
        version: agent.version,
        configJson,
      });

      return { agentVersion: agent.version, restored };
    });
  }
}

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { SkillEvalRunSummary } from '@devdigest/shared';
import type { NewSkillRun, SkillEvalAgentRow, SkillForRun } from '../editor-types.js';
import type { CaseForRun } from '../types.js';

/**
 * Skill evals data-access (SPEC-06): the agent remembered per skill
 * (`skill_eval_agents`), the skill a run injects, the skill's cases for a run
 * and the skill runs in `eval_suite_runs` (`agent_id` NULL, `skill_id` set).
 * Every read and write is workspace-scoped. Never imports the module's
 * `EvalRepository` file: that file imports `toSkillRunSummary` from here.
 */

const ONE_RUNNING_SKILL_INDEX = 'eval_suite_runs_one_running_skill_uq';
const UNIQUE_VIOLATION = '23505';

/** True when `err` (or its cause) is a Postgres unique violation on `constraint`. */
function isUniqueViolationOn(err: unknown, constraint: string): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 3 && cur && typeof cur === 'object'; depth += 1) {
    const e = cur as {
      code?: string;
      constraint_name?: string;
      constraint?: string;
      message?: string;
      cause?: unknown;
    };
    if (e.code === UNIQUE_VIOLATION) {
      const name = e.constraint_name ?? e.constraint;
      if (name === constraint) return true;
      if (name === undefined && typeof e.message === 'string' && e.message.includes(constraint)) {
        return true;
      }
    }
    cur = e.cause;
  }
  return false;
}

/**
 * The one row → `SkillEvalRunSummary` mapping (also used by `getRun`, R4).
 * `null` when the row is not a skill run. `agent_id` is the via agent, null
 * once that agent was deleted; `cost_usd` null stays null (unknown cost).
 */
export function toSkillRunSummary(
  row: typeof t.evalSuiteRuns.$inferSelect,
): SkillEvalRunSummary | null {
  if (row.skillId === null || row.skillVersion === null || row.agentName === null) return null;
  return {
    id: row.id,
    skill_id: row.skillId,
    skill_version: row.skillVersion,
    agent_id: row.viaAgentId,
    agent_name: row.agentName,
    agent_deleted: row.viaAgentId === null,
    status: row.status,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
    duration_ms: row.durationMs,
    agent_version: row.agentVersion,
    cases_total: row.casesTotal,
    cases_done: row.casesDone,
    cases_scored: row.casesScored,
    cases_passed: row.casesPassed,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    cost_usd: row.costUsd,
    error: row.error,
  };
}

export class SkillEvalRepository {
  constructor(private db: Db) {}

  /** The skill's current content, whatever its `enabled` flag (SPEC-06 EC20). */
  async skillForRun(workspaceId: string, skillId: string): Promise<SkillForRun | undefined> {
    const [row] = await this.db
      .select({
        id: t.skills.id,
        name: t.skills.name,
        description: t.skills.description,
        body: t.skills.body,
        version: t.skills.version,
      })
      .from(t.skills)
      .where(and(eq(t.skills.id, skillId), eq(t.skills.workspaceId, workspaceId)))
      .limit(1);
    return row;
  }

  /** The remembered agent; `undefined` when none was ever chosen for the skill. */
  async evalAgent(workspaceId: string, skillId: string): Promise<SkillEvalAgentRow | undefined> {
    const [row] = await this.db
      .select({ agentId: t.skillEvalAgents.agentId, agentName: t.skillEvalAgents.agentName })
      .from(t.skillEvalAgents)
      .where(
        and(
          eq(t.skillEvalAgents.skillId, skillId),
          eq(t.skillEvalAgents.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return row;
  }

  async setEvalAgent(
    workspaceId: string,
    skillId: string,
    agent: { id: string; name: string },
  ): Promise<void> {
    await this.db
      .insert(t.skillEvalAgents)
      .values({ skillId, workspaceId, agentId: agent.id, agentName: agent.name })
      .onConflictDoUpdate({
        target: t.skillEvalAgents.skillId,
        set: { agentId: agent.id, agentName: agent.name, updatedAt: new Date() },
        // Never take over another workspace's row for the same skill id.
        setWhere: eq(t.skillEvalAgents.workspaceId, workspaceId),
      });
  }

  async agentName(workspaceId: string, agentId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ name: t.agents.name })
      .from(t.agents)
      .where(and(eq(t.agents.id, agentId), eq(t.agents.workspaceId, workspaceId)))
      .limit(1);
    return row?.name;
  }

  /** The skill's cases at their current revision, oldest first. One query. */
  async casesForSkill(workspaceId: string, skillId: string): Promise<CaseForRun[]> {
    const rows = await this.db
      .selectDistinctOn([t.evalCases.id], { c: t.evalCases, r: t.evalCaseRevisions })
      .from(t.evalCases)
      .innerJoin(t.evalCaseRevisions, eq(t.evalCaseRevisions.caseId, t.evalCases.id))
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.skillId, skillId)))
      .orderBy(t.evalCases.id, desc(t.evalCaseRevisions.revision));
    return rows
      .sort(
        (a, b) =>
          a.c.createdAt.getTime() - b.c.createdAt.getTime() || a.c.id.localeCompare(b.c.id),
      )
      .map(({ c, r }) => ({
        id: c.id,
        revisionId: r.id,
        revision: r.revision,
        name: c.name,
        expectationType: r.expectationType,
        expectation: r.expectation,
        inputDiff: r.inputDiff,
        inputMeta: r.inputMeta,
      }));
  }

  /** Inserts the `running` skill run; `null` when the skill already has a running run. */
  async createSkillRun(values: NewSkillRun): Promise<string | null> {
    try {
      const [row] = await this.db
        .insert(t.evalSuiteRuns)
        .values({
          workspaceId: values.workspaceId,
          agentId: null,
          skillId: values.skillId,
          skillVersion: values.skillVersion,
          viaAgentId: values.viaAgentId,
          agentName: values.agentName,
          status: 'running',
          agentVersion: values.agentVersion,
          config: values.config,
          cases: values.cases,
          casesTotal: values.cases.length,
        })
        .returning({ id: t.evalSuiteRuns.id });
      if (!row) throw new Error('skill eval run insert returned no row');
      return row.id;
    } catch (err) {
      if (isUniqueViolationOn(err, ONE_RUNNING_SKILL_INDEX)) return null;
      throw err;
    }
  }

  /** The skill's runs, newest first. */
  async listSkillRuns(workspaceId: string, skillId: string): Promise<SkillEvalRunSummary[]> {
    const rows = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.evalSuiteRuns.skillId, skillId)))
      .orderBy(desc(t.evalSuiteRuns.startedAt));
    const runs: SkillEvalRunSummary[] = [];
    for (const row of rows) {
      const summary = toSkillRunSummary(row);
      if (summary) runs.push(summary);
    }
    return runs;
  }
}

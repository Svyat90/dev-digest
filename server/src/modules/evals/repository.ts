import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  AgentEvalCase,
  AgentEvalCaseListItem,
  AgentEvalRunDetail,
  AgentEvalRunSummary,
  EvalCaseLatestResult,
  EvalCaseProvenance,
  EvalRunRecord,
} from '@devdigest/shared';
import type {
  AgentConfigSource,
  CaseForRun,
  CaseResultInsert,
  FindingForCase,
  NewEvalCase,
  NewEvalRun,
  RunClose,
} from './types.js';

/**
 * Evals data-access. Owns `eval_cases`, `eval_case_revisions`,
 * `eval_suite_runs` and `eval_runs` (the per-case results of a suite run).
 * Every domain read/write is workspace-scoped; findings are reached only
 * through the `reviews` join (the `findings` table has no `workspace_id`).
 * Case revisions are append-only: nothing here updates or deletes one — only the
 * FK cascade of a deleted case removes them.
 */

const FIRST_CASE_REVISION = 1;
const OWNER_NAME_INDEX = 'eval_cases_owner_name_uq';
const ONE_RUNNING_INDEX = 'eval_suite_runs_one_running_uq';
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

/** A case row joined with its current (highest) revision row. */
interface CaseWithRevision {
  c: typeof t.evalCases.$inferSelect;
  r: typeof t.evalCaseRevisions.$inferSelect;
}

function toCase(row: CaseWithRevision): AgentEvalCase {
  return {
    id: row.c.id,
    agent_id: row.c.agentId ?? row.c.ownerId,
    name: row.c.name,
    revision_id: row.r.id,
    revision: row.r.revision,
    expectation_type: row.r.expectationType,
    expectation: row.r.expectation,
    input_file: row.r.inputFiles[0] ?? row.r.expectation.file,
    input_meta: row.r.inputMeta,
    // SPEC-04 writes provenance on every case it creates.
    provenance: row.c.provenance as EvalCaseProvenance,
    created_at: row.c.createdAt.toISOString(),
  };
}

function toSummary(row: typeof t.evalSuiteRuns.$inferSelect): AgentEvalRunSummary {
  return {
    id: row.id,
    agent_id: row.agentId,
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

function toRecord(row: typeof t.evalRuns.$inferSelect): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: row.caseName,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput,
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
    eval_run_id: row.suiteRunId,
    case_revision_id: row.caseRevisionId,
    status: row.status,
    error: row.error,
    expectation_type: row.expectationType,
    expectation: row.expectation,
    findings_returned: row.findingsReturned,
    findings_grounded: row.findingsGrounded,
    findings_matching: row.findingsMatching,
  };
}

export class EvalRepository {
  constructor(private db: Db) {}

  /** A finding with its review, PR and repo; `null`-safe agent version from the run trace. */
  async findingForCase(
    workspaceId: string,
    findingId: string,
  ): Promise<FindingForCase | undefined> {
    const [row] = await this.db
      .select({
        f: t.findings,
        review: t.reviews,
        pull: t.pullRequests,
        repo: t.repos,
        agentVersion: sql<string | null>`${t.runTraces.trace}->'config'->>'version'`,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.reviews.prId))
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .leftJoin(t.runTraces, eq(t.runTraces.runId, t.reviews.runId))
      .where(and(eq(t.findings.id, findingId), eq(t.reviews.workspaceId, workspaceId)))
      .limit(1);
    if (!row) return undefined;
    const parsed = row.agentVersion === null ? Number.NaN : Number.parseInt(row.agentVersion, 10);
    return {
      finding: {
        id: row.f.id,
        file: row.f.file,
        startLine: row.f.startLine,
        endLine: row.f.endLine,
        kind: row.f.kind,
        severity: row.f.severity,
        category: row.f.category,
        title: row.f.title,
        acceptedAt: row.f.acceptedAt,
        dismissedAt: row.f.dismissedAt,
      },
      review: { id: row.review.id, agentId: row.review.agentId, runId: row.review.runId },
      pull: {
        id: row.pull.id,
        number: row.pull.number,
        title: row.pull.title,
        body: row.pull.body,
      },
      repo: { id: row.repo.id, fullName: row.repo.fullName },
      agentVersion: Number.isFinite(parsed) ? parsed : null,
    };
  }

  async agentExists(workspaceId: string, agentId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.id, agentId), eq(t.agents.workspaceId, workspaceId)))
      .limit(1);
    return rows.length > 0;
  }

  /** The stored patch of one PR file; null when there is no such row or no patch. */
  async prFilePatch(prId: string, path: string): Promise<string | null> {
    const [row] = await this.db
      .select({ patch: t.prFiles.patch })
      .from(t.prFiles)
      .where(and(eq(t.prFiles.prId, prId), eq(t.prFiles.path, path)))
      .limit(1);
    return row?.patch ?? null;
  }

  async agentCaseNames(workspaceId: string, agentId: string): Promise<string[]> {
    const rows = await this.db
      .select({ name: t.evalCases.name })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      );
    return rows.map((r) => r.name);
  }

  /**
   * Insert a case and its revision 1 in one transaction. A repeat for the same
   * finding returns the existing case (`created: false`). `null` means the name
   * was taken in the set by a concurrent insert — the transaction rolled back
   * and nothing was written; the service re-picks a name and retries.
   */
  async insertCase(
    values: NewEvalCase,
  ): Promise<{ case: AgentEvalCase; created: boolean } | null> {
    try {
      return await this.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(t.evalCases)
          .values({
            workspaceId: values.workspaceId,
            ownerKind: 'agent',
            ownerId: values.agentId,
            agentId: values.agentId,
            name: values.name,
            sourceFindingId: values.sourceFindingId,
            provenance: values.provenance,
          })
          .onConflictDoNothing({ target: [t.evalCases.agentId, t.evalCases.sourceFindingId] })
          .returning();

        if (inserted) {
          const [revision] = await tx
            .insert(t.evalCaseRevisions)
            .values({
              workspaceId: values.workspaceId,
              caseId: inserted.id,
              revision: FIRST_CASE_REVISION,
              inputDiff: values.inputDiff,
              inputFiles: [values.inputFile],
              inputMeta: values.inputMeta,
              expectationType: values.expectationType,
              expectation: values.expectation,
            })
            .returning();
          return { case: toCase({ c: inserted, r: revision! }), created: true };
        }

        const [existing] = await tx
          .selectDistinctOn([t.evalCases.id], { c: t.evalCases, r: t.evalCaseRevisions })
          .from(t.evalCases)
          .innerJoin(t.evalCaseRevisions, eq(t.evalCaseRevisions.caseId, t.evalCases.id))
          .where(
            and(
              eq(t.evalCases.workspaceId, values.workspaceId),
              eq(t.evalCases.agentId, values.agentId),
              eq(t.evalCases.sourceFindingId, values.sourceFindingId),
            ),
          )
          .orderBy(t.evalCases.id, desc(t.evalCaseRevisions.revision));
        if (!existing) throw new Error('eval case vanished after a conflicting insert');
        return { case: toCase(existing), created: false };
      });
    } catch (err) {
      if (isUniqueViolationOn(err, OWNER_NAME_INDEX)) return null;
      throw err;
    }
  }

  /** The agent's cases at their current revision, oldest first. One query. */
  private async currentCases(workspaceId: string, agentId: string): Promise<CaseWithRevision[]> {
    const rows = await this.db
      .selectDistinctOn([t.evalCases.id], { c: t.evalCases, r: t.evalCaseRevisions })
      .from(t.evalCases)
      .innerJoin(t.evalCaseRevisions, eq(t.evalCaseRevisions.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      )
      .orderBy(t.evalCases.id, desc(t.evalCaseRevisions.revision));
    return rows.sort(
      (a, b) =>
        a.c.createdAt.getTime() - b.c.createdAt.getTime() || a.c.id.localeCompare(b.c.id),
    );
  }

  async listCases(workspaceId: string, agentId: string): Promise<AgentEvalCaseListItem[]> {
    const cases = await this.currentCases(workspaceId, agentId);
    if (cases.length === 0) return [];

    const [latest] = await this.db
      .select({ id: t.evalSuiteRuns.id })
      .from(t.evalSuiteRuns)
      .where(
        and(
          eq(t.evalSuiteRuns.workspaceId, workspaceId),
          eq(t.evalSuiteRuns.agentId, agentId),
          eq(t.evalSuiteRuns.status, 'completed'),
        ),
      )
      .orderBy(desc(t.evalSuiteRuns.startedAt))
      .limit(1);

    const results = new Map<string, EvalCaseLatestResult>();
    if (latest) {
      const rows = await this.db
        .select()
        .from(t.evalRuns)
        .where(
          and(
            eq(t.evalRuns.suiteRunId, latest.id),
            eq(t.evalRuns.workspaceId, workspaceId),
            inArray(
              t.evalRuns.caseId,
              cases.map((x) => x.c.id),
            ),
          ),
        );
      for (const r of rows) {
        if (!r.caseId) continue;
        results.set(r.caseId, {
          eval_run_id: r.suiteRunId,
          case_revision_id: r.caseRevisionId,
          status: r.status,
          // A1: one finding is expected from a must_find case, none from a must_not_flag.
          expected: r.expectationType === 'must_find' ? 1 : 0,
          got: r.findingsMatching,
          error: r.error,
        });
      }
    }

    return cases.map((x) => ({ ...toCase(x), latest_result: results.get(x.c.id) ?? null }));
  }

  /** Deletes the case only; the FK cascade removes its revisions, results keep a null `case_id`. */
  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.id, caseId), eq(t.evalCases.workspaceId, workspaceId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  async casesForRun(workspaceId: string, agentId: string): Promise<CaseForRun[]> {
    const cases = await this.currentCases(workspaceId, agentId);
    return cases.map((x) => ({
      id: x.c.id,
      revisionId: x.r.id,
      revision: x.r.revision,
      name: x.c.name,
      expectationType: x.r.expectationType,
      expectation: x.r.expectation,
      inputDiff: x.r.inputDiff,
      inputMeta: x.r.inputMeta,
    }));
  }

  async agentConfigSource(
    workspaceId: string,
    agentId: string,
  ): Promise<AgentConfigSource | undefined> {
    const [agent] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.id, agentId), eq(t.agents.workspaceId, workspaceId)))
      .limit(1);
    if (!agent) return undefined;
    const links = await this.db
      .select({ link: t.agentSkills, skill: t.skills })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.skills.workspaceId, workspaceId)))
      .orderBy(asc(t.agentSkills.order));
    return {
      agent: {
        id: agent.id,
        name: agent.name,
        version: agent.version,
        provider: agent.provider,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        strategy: agent.strategy,
      },
      skills: links.map(({ link, skill }) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        body: skill.body,
        version: skill.version,
        order: link.order,
        linkEnabled: link.enabled,
        skillEnabled: skill.enabled,
      })),
    };
  }

  /** Inserts the `running` row; `null` when the agent already has a running run. */
  async createRun(values: NewEvalRun): Promise<string | null> {
    try {
      const [row] = await this.db
        .insert(t.evalSuiteRuns)
        .values({
          workspaceId: values.workspaceId,
          agentId: values.agentId,
          status: 'running',
          agentVersion: values.agentVersion,
          config: values.config,
          cases: values.cases,
          casesTotal: values.cases.length,
        })
        .returning({ id: t.evalSuiteRuns.id });
      return row!.id;
    } catch (err) {
      if (isUniqueViolationOn(err, ONE_RUNNING_INDEX)) return null;
      throw err;
    }
  }

  /** One result row plus the run's progress counter, atomically. */
  async insertCaseResult(values: CaseResultInsert): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(t.evalRuns).values({
        workspaceId: values.workspaceId,
        suiteRunId: values.evalRunId,
        caseId: values.caseId,
        caseRevisionId: values.caseRevisionId,
        caseName: values.caseName,
        status: values.status,
        error: values.error,
        expectationType: values.expectationType,
        expectation: values.expectation,
        findingsReturned: values.findingsReturned,
        findingsGrounded: values.findingsGrounded,
        findingsMatching: values.findingsMatching,
        actualOutput: values.actualOutput,
        pass: values.status === 'errored' ? null : values.status === 'passed',
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        durationMs: values.durationMs,
        costUsd: values.costUsd,
      });
      await tx
        .update(t.evalSuiteRuns)
        .set({ casesDone: sql`${t.evalSuiteRuns.casesDone} + 1` })
        .where(eq(t.evalSuiteRuns.id, values.evalRunId));
    });
  }

  async runResults(runId: string): Promise<EvalRunRecord[]> {
    const rows = await this.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.suiteRunId, runId))
      .orderBy(asc(t.evalRuns.ranAt), asc(t.evalRuns.id));
    return rows.map(toRecord);
  }

  async closeRun(runId: string, values: RunClose): Promise<void> {
    await this.db
      .update(t.evalSuiteRuns)
      .set({
        status: values.status,
        finishedAt: values.finishedAt,
        durationMs: values.durationMs,
        casesScored: values.casesScored,
        casesPassed: values.casesPassed,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        costUsd: values.costUsd,
        error: values.error,
      })
      .where(eq(t.evalSuiteRuns.id, runId));
  }

  async listRuns(workspaceId: string, agentId: string): Promise<AgentEvalRunSummary[]> {
    const rows = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.evalSuiteRuns.agentId, agentId)))
      .orderBy(desc(t.evalSuiteRuns.startedAt));
    return rows.map(toSummary);
  }

  async getRun(workspaceId: string, runId: string): Promise<AgentEvalRunDetail | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalSuiteRuns)
      .where(and(eq(t.evalSuiteRuns.id, runId), eq(t.evalSuiteRuns.workspaceId, workspaceId)))
      .limit(1);
    if (!row) return undefined;
    return {
      ...toSummary(row),
      config: row.config,
      cases: row.cases,
      results: await this.runResults(runId),
    };
  }

  /** Boot-time read for the reaper (unscoped: every workspace's orphans). */
  async runningRuns(): Promise<{ id: string; startedAt: Date }[]> {
    return this.db
      .select({ id: t.evalSuiteRuns.id, startedAt: t.evalSuiteRuns.startedAt })
      .from(t.evalSuiteRuns)
      .where(eq(t.evalSuiteRuns.status, 'running'));
  }

  /** Time of the run's last stored case result; null when it has none. */
  async lastResultAt(runId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ ranAt: t.evalRuns.ranAt })
      .from(t.evalRuns)
      .where(eq(t.evalRuns.suiteRunId, runId))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(1);
    return row?.ranAt ?? null;
  }
}

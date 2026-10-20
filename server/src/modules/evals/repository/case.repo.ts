import { and, desc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type {
  AgentEvalCase,
  EvalCaseCheck,
  EvalCaseLastRun,
  EvalCaseLatestResult,
  EvalCaseListItem,
  EvalCaseOwner,
} from '@devdigest/shared';
import type {
  CaseUpdate,
  CaseUpdateOutcome,
  CheckFinish,
  CheckStart,
  NewManualCase,
  StoredCase,
  StoredCaseView,
} from '../editor-types.js';
import { expectedCount } from '../helpers.js';
import type { CaseForRun } from '../types.js';

/**
 * Case editor data-access (SPEC-06): cases of either owner at their current
 * revision, manual cases, edits as new revisions, and single-case checks
 * (`eval_case_checks`). Every read and write is scoped by `workspace_id` and,
 * for owner reads, by `owner_kind` plus `agent_id` / `skill_id`, so a skill's
 * case is invisible under an agent's route and the other way round.
 * Revisions are append-only: nothing here updates or deletes one.
 */

const FIRST_CASE_REVISION = 1;
const UNIQUE_VIOLATION = '23505';
const OWNER_NAME_INDEX = 'eval_cases_owner_name_uq';
const CASE_REVISION_INDEX = 'eval_case_revisions_case_rev_uq';
const ONE_RUNNING_CHECK_INDEX = 'eval_case_checks_one_running_uq';

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

type ResultRow = typeof t.evalRuns.$inferSelect;
type CheckRow = typeof t.evalCaseChecks.$inferSelect;

/** The cases of one owner's set: workspace, owner kind and the owner's FK column. */
function ownerCases(workspaceId: string, owner: EvalCaseOwner): SQL {
  return and(
    eq(t.evalCases.workspaceId, workspaceId),
    eq(t.evalCases.ownerKind, owner.kind),
    eq(t.evalCases.ownerId, owner.id),
    owner.kind === 'agent' ? eq(t.evalCases.agentId, owner.id) : eq(t.evalCases.skillId, owner.id),
  )!;
}

/** The owner's own runs: agent runs exclude skill runs that went through it. */
function ownerRuns(workspaceId: string, owner: EvalCaseOwner): SQL {
  return and(
    eq(t.evalSuiteRuns.workspaceId, workspaceId),
    eq(t.evalSuiteRuns.status, 'completed'),
    ...(owner.kind === 'agent'
      ? [eq(t.evalSuiteRuns.agentId, owner.id), isNull(t.evalSuiteRuns.skillId)]
      : [eq(t.evalSuiteRuns.skillId, owner.id)]),
  )!;
}

function toStoredCase(row: CaseWithRevision): StoredCase {
  return {
    id: row.c.id,
    owner: { kind: row.c.ownerKind, id: row.c.ownerId },
    name: row.c.name,
    provenance: row.c.provenance ?? null,
    createdAt: row.c.createdAt,
    revisionId: row.r.id,
    revision: row.r.revision,
    content: {
      inputDiff: row.r.inputDiff,
      inputFiles: row.r.inputFiles,
      inputMeta: row.r.inputMeta,
      expectationType: row.r.expectationType,
      expectation: row.r.expectation,
      expectedOutput: row.r.expectedOutput ?? null,
    },
  };
}

function toCase(stored: StoredCase): AgentEvalCase {
  return {
    id: stored.id,
    agent_id: stored.owner.kind === 'agent' ? stored.owner.id : null,
    name: stored.name,
    revision_id: stored.revisionId,
    revision: stored.revision,
    expectation_type: stored.content.expectationType,
    expectation: stored.content.expectation,
    input_file: stored.content.inputFiles[0] ?? stored.content.expectation.file,
    input_meta: stored.content.inputMeta,
    provenance: stored.provenance,
    created_at: stored.createdAt.toISOString(),
  };
}

function toLatestResult(row: ResultRow): EvalCaseLatestResult {
  return {
    eval_run_id: row.suiteRunId,
    case_revision_id: row.caseRevisionId,
    status: row.status,
    expected: expectedCount(row.expectationType),
    got: row.findingsMatching,
    error: row.error,
  };
}

/** A run result as the editor's last-run strip; the caller checks the revision (A3). */
function toRunLastRun(row: ResultRow): EvalCaseLastRun {
  return {
    source: 'run',
    status: row.status,
    expected: expectedCount(row.expectationType),
    got: row.findingsMatching,
    error: row.error,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
    finished_at: row.ranAt.toISOString(),
  };
}

function toCheck(row: CheckRow): EvalCaseCheck {
  return {
    id: row.id,
    case_revision_id: row.caseRevisionId,
    status: row.status,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
    duration_ms: row.durationMs,
    expected: row.expected,
    got: row.got,
    error: row.error,
    cost_usd: row.costUsd,
  };
}

export class EvalCaseRepository {
  constructor(private db: Db) {}

  /** The agent's or skill's name in the workspace; undefined when there is no such owner. */
  async ownerName(workspaceId: string, owner: EvalCaseOwner): Promise<string | undefined> {
    const table = owner.kind === 'agent' ? t.agents : t.skills;
    const [row] = await this.db
      .select({ name: table.name })
      .from(table)
      .where(and(eq(table.id, owner.id), eq(table.workspaceId, workspaceId)))
      .limit(1);
    return row?.name;
  }

  /** Ids and names of every case in the owner's set. One query. */
  async caseNames(
    workspaceId: string,
    owner: EvalCaseOwner,
  ): Promise<{ id: string; name: string }[]> {
    return this.db
      .select({ id: t.evalCases.id, name: t.evalCases.name })
      .from(t.evalCases)
      .where(ownerCases(workspaceId, owner));
  }

  /** The owner's cases at their current revision, oldest first; optionally one case. One query. */
  private async currentCases(
    workspaceId: string,
    owner: EvalCaseOwner,
    caseId?: string,
  ): Promise<CaseWithRevision[]> {
    const rows = await this.db
      .selectDistinctOn([t.evalCases.id], { c: t.evalCases, r: t.evalCaseRevisions })
      .from(t.evalCases)
      .innerJoin(t.evalCaseRevisions, eq(t.evalCaseRevisions.caseId, t.evalCases.id))
      .where(
        caseId === undefined
          ? ownerCases(workspaceId, owner)
          : and(ownerCases(workspaceId, owner), eq(t.evalCases.id, caseId)),
      )
      .orderBy(t.evalCases.id, desc(t.evalCaseRevisions.revision));
    return rows.sort(
      (a, b) =>
        a.c.createdAt.getTime() - b.c.createdAt.getTime() || a.c.id.localeCompare(b.c.id),
    );
  }

  /**
   * Cases with their past results, in a fixed number of queries whatever the
   * case count: cases + current revision, the owner's latest completed run,
   * its result rows, and the checks of the current revisions.
   */
  private async views(
    workspaceId: string,
    owner: EvalCaseOwner,
    caseId?: string,
  ): Promise<StoredCaseView[]> {
    const cases = await this.currentCases(workspaceId, owner, caseId);
    if (cases.length === 0) return [];

    const [latest] = await this.db
      .select({ id: t.evalSuiteRuns.id })
      .from(t.evalSuiteRuns)
      .where(ownerRuns(workspaceId, owner))
      .orderBy(desc(t.evalSuiteRuns.startedAt))
      .limit(1);

    const results = new Map<string, ResultRow>();
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
      for (const r of rows) if (r.caseId) results.set(r.caseId, r);
    }

    const checkRows = await this.db
      .select()
      .from(t.evalCaseChecks)
      .where(
        and(
          eq(t.evalCaseChecks.workspaceId, workspaceId),
          inArray(
            t.evalCaseChecks.caseRevisionId,
            cases.map((x) => x.r.id),
          ),
        ),
      );
    const checks = new Map(checkRows.map((row) => [row.caseRevisionId, row]));

    return cases.map((x) => {
      const result = results.get(x.c.id);
      const check = checks.get(x.r.id);
      return {
        stored: toStoredCase(x),
        latestResult: result ? toLatestResult(result) : null,
        // A3: a run result counts for the strip only when it covered the current revision.
        runResult: result && result.caseRevisionId === x.r.id ? toRunLastRun(result) : null,
        check: check ? toCheck(check) : null,
      };
    });
  }

  async listCases(workspaceId: string, owner: EvalCaseOwner): Promise<EvalCaseListItem[]> {
    const views = await this.views(workspaceId, owner);
    return views.map((v) => ({
      ...toCase(v.stored),
      latest_result: v.latestResult,
      check: v.check,
    }));
  }

  async getCase(
    workspaceId: string,
    owner: EvalCaseOwner,
    caseId: string,
  ): Promise<StoredCaseView | undefined> {
    const [view] = await this.views(workspaceId, owner, caseId);
    return view;
  }

  /**
   * Insert a hand-written case and its revision 1 in one transaction; returns
   * the case id. `null` = the name is taken in the set (`eval_cases_owner_name_uq`):
   * the transaction rolled back and nothing was written (A1).
   */
  async insertManualCase(values: NewManualCase): Promise<string | null> {
    try {
      return await this.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(t.evalCases)
          .values({
            workspaceId: values.workspaceId,
            ownerKind: values.owner.kind,
            ownerId: values.owner.id,
            agentId: values.owner.kind === 'agent' ? values.owner.id : null,
            skillId: values.owner.kind === 'skill' ? values.owner.id : null,
            name: values.name,
          })
          .returning({ id: t.evalCases.id });
        await tx.insert(t.evalCaseRevisions).values({
          workspaceId: values.workspaceId,
          caseId: inserted!.id,
          revision: FIRST_CASE_REVISION,
          inputDiff: values.content.inputDiff,
          inputFiles: values.content.inputFiles,
          inputMeta: values.content.inputMeta,
          expectationType: values.content.expectationType,
          expectation: values.content.expectation,
          expectedOutput: values.content.expectedOutput,
        });
        return inserted!.id;
      });
    } catch (err) {
      if (isUniqueViolationOn(err, OWNER_NAME_INDEX)) return null;
      throw err;
    }
  }

  /**
   * Save an existing case in one transaction: the name, plus a new revision
   * when `content` is set. A concurrent revision (A13) or a case gone since it
   * was read answers `conflict`; a name taken in the set answers `name_taken`
   * (A1). Both roll back, so nothing is written.
   */
  async updateCase(values: CaseUpdate): Promise<CaseUpdateOutcome> {
    try {
      return await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(t.evalCases)
          .set({ name: values.name })
          .where(
            and(eq(t.evalCases.id, values.caseId), eq(t.evalCases.workspaceId, values.workspaceId)),
          )
          .returning({ id: t.evalCases.id });
        if (updated.length === 0) return 'conflict';
        if (!values.content) return 'renamed';

        await tx.insert(t.evalCaseRevisions).values({
          workspaceId: values.workspaceId,
          caseId: values.caseId,
          revision: sql<number>`(select coalesce(max(${t.evalCaseRevisions.revision}), 0) + 1 from ${t.evalCaseRevisions} where ${t.evalCaseRevisions.caseId} = ${values.caseId})`,
          inputDiff: values.content.inputDiff,
          inputFiles: values.content.inputFiles,
          inputMeta: values.content.inputMeta,
          expectationType: values.content.expectationType,
          expectation: values.content.expectation,
          expectedOutput: values.content.expectedOutput,
        });
        return 'revised';
      });
    } catch (err) {
      if (isUniqueViolationOn(err, CASE_REVISION_INDEX)) return 'conflict';
      if (isUniqueViolationOn(err, OWNER_NAME_INDEX)) return 'name_taken';
      throw err;
    }
  }

  /** One case of the owner's set at its current revision, as a run consumes it. */
  async caseForRun(
    workspaceId: string,
    owner: EvalCaseOwner,
    caseId: string,
  ): Promise<CaseForRun | undefined> {
    const [x] = await this.currentCases(workspaceId, owner, caseId);
    if (!x) return undefined;
    return {
      id: x.c.id,
      revisionId: x.r.id,
      revision: x.r.revision,
      name: x.c.name,
      expectationType: x.r.expectationType,
      expectation: x.r.expectation,
      inputDiff: x.r.inputDiff,
      inputMeta: x.r.inputMeta,
    };
  }

  /**
   * Open a `running` check for one revision in one statement: insert, or reset
   * that revision's finished row (newest result per revision). `null` when the
   * revision's check is still running, or another revision of the case has one
   * running (`eval_case_checks_one_running_uq`).
   */
  async startCheck(values: CheckStart): Promise<string | null> {
    try {
      const [row] = await this.db
        .insert(t.evalCaseChecks)
        .values({
          workspaceId: values.workspaceId,
          caseId: values.caseId,
          caseRevisionId: values.caseRevisionId,
          status: 'running',
          expected: values.expected,
        })
        .onConflictDoUpdate({
          target: t.evalCaseChecks.caseRevisionId,
          set: {
            status: 'running',
            startedAt: sql`now()`,
            finishedAt: null,
            durationMs: null,
            expected: values.expected,
            got: null,
            error: null,
            costUsd: null,
            findingsReturned: null,
            findingsGrounded: null,
            findingsMatching: null,
          },
          setWhere: ne(t.evalCaseChecks.status, 'running'),
        })
        .returning({ id: t.evalCaseChecks.id });
      return row?.id ?? null;
    } catch (err) {
      if (isUniqueViolationOn(err, ONE_RUNNING_CHECK_INDEX)) return null;
      throw err;
    }
  }

  /** Close the check the caller opened; a row no longer `running` is left alone. */
  async finishCheck(checkId: string, values: CheckFinish): Promise<void> {
    await this.db
      .update(t.evalCaseChecks)
      .set({
        status: values.status,
        finishedAt: values.finishedAt,
        durationMs: values.durationMs,
        got: values.got,
        error: values.error,
        costUsd: values.costUsd,
        findingsReturned: values.findingsReturned,
        findingsGrounded: values.findingsGrounded,
        findingsMatching: values.findingsMatching,
      })
      .where(and(eq(t.evalCaseChecks.id, checkId), eq(t.evalCaseChecks.status, 'running')));
  }

  /** Boot only (unscoped: every workspace's orphans): close every running check as errored (A11). */
  async failRunningChecks(reason: string, finishedAt: Date): Promise<number> {
    const rows = await this.db
      .update(t.evalCaseChecks)
      .set({ status: 'errored', error: reason, finishedAt })
      .where(eq(t.evalCaseChecks.status, 'running'))
      .returning({ id: t.evalCaseChecks.id });
    return rows.length;
  }
}

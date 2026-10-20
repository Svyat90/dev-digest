import type {
  AgentEvalRunSummary,
  CreateEvalCaseResponse,
  EvalErrorCode,
  EvalRunConfig,
  EvalRunDetail,
  EvalRunCaseRef,
  FindingCategory,
  Severity,
  SkillEvalAgent,
  SkillEvalRunSummary,
  StartEvalRunResponse,
} from '@devdigest/shared';
import { aggregateRun } from '../../domain/evals/scoring.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { EVAL_CASE_CONCURRENCY, MAX_CASE_NAME_ATTEMPTS } from './constants.js';
import {
  buildRunConfig,
  capDescription,
  caseNameFromTitle,
  decideCaseCreation,
  errorReason,
  frozenDiff,
  mapWithConcurrency,
  uniqueCaseName,
} from './helpers.js';
import type { EvalRepository } from './repository.js';
import type { SkillEvalRepository } from './repository/skill-eval.repo.js';
import {
  resolveRunConfig,
  runCaseReview,
  type CaseRunnerDeps,
  type RunConfigPorts,
} from './run-executor.js';
import type { CaseForRun, CaseResultInsert, EvalLogger, RunClose } from './types.js';

/**
 * Narrow dependency set of the eval use cases: functions over the container's
 * facades and ports, never `Container` (server/INSIGHTS.md, 2026-09-22). The
 * container builds it.
 */
export interface EvalDeps extends CaseRunnerDeps {
  repo: Pick<
    EvalRepository,
    | 'findingForCase'
    | 'agentExists'
    | 'prFilePatch'
    | 'agentCaseNames'
    | 'insertCase'
    | 'deleteCase'
    | 'casesForRun'
    | 'agentConfigSource'
    | 'createRun'
    | 'insertCaseResult'
    | 'runResults'
    | 'closeRun'
    | 'listRuns'
    | 'getRun'
    | 'runningRuns'
    | 'lastResultAt'
  >;
  /** Skill evals (SPEC-06): the remembered agent, the measured skill and skill runs. */
  skills: Pick<
    SkillEvalRepository,
    | 'skillForRun'
    | 'evalAgent'
    | 'setEvalAgent'
    | 'agentName'
    | 'casesForSkill'
    | 'createSkillRun'
    | 'listSkillRuns'
  >;
}

const CONFLICT_CODES: ReadonlySet<EvalErrorCode> = new Set([
  'eval_run_in_progress',
  'eval_case_edit_conflict',
  'eval_case_check_in_progress',
]);

/** Statuses of the closed set of refusals: 409 for a conflict with work in progress, else 422. */
function refusal(code: EvalErrorCode, message: string): AppError {
  return new AppError(code, message, CONFLICT_CODES.has(code) ? 409 : 422);
}

const REFUSAL_MESSAGES: Record<EvalErrorCode, string> = {
  eval_case_undecided: 'The finding is neither accepted nor dismissed',
  eval_case_no_agent: 'The finding has no agent to own the case',
  eval_case_agent_missing: 'The agent that produced the finding no longer exists',
  eval_case_no_diff: 'No stored diff for the finding file',
  eval_case_diff_too_large: 'The stored diff of the file is too large',
  eval_case_lines_outside_diff: 'The finding lines are outside the stored diff',
  no_eval_cases: 'The agent has no eval cases',
  eval_run_in_progress: 'An eval run is already in progress for this agent',
  eval_run_not_completed: 'The eval run has not completed',
  eval_promote_noop: "The agent already matches this run's configuration",
  eval_case_invalid: 'The eval case is invalid',
  eval_case_content_fixed: 'A case created from a finding has fixed input and expectation',
  eval_case_edit_conflict: 'The case changed while you were editing',
  eval_case_check_in_progress: 'The case is already running',
  eval_agent_required: 'Choose an agent for this skill first',
  eval_agent_missing: "The skill's eval agent no longer exists",
};

export class EvalService {
  constructor(private deps: EvalDeps) {}

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  /** POST /findings/:id/eval-case — frozen case from a decided finding; idempotent per finding. */
  async createCaseFromFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<CreateEvalCaseResponse> {
    const { repo } = this.deps;
    const source = await repo.findingForCase(workspaceId, findingId);
    if (!source) throw new NotFoundError('Finding not found');

    const { finding, review, pull, repo: repoRef } = source;
    const agentId = review.agentId;
    const agentExists = agentId ? await repo.agentExists(workspaceId, agentId) : false;
    const patch = await repo.prFilePatch(pull.id, finding.file);
    const raw = patch === null ? null : frozenDiff(finding.file, patch);
    const diff = raw === null ? null : this.deps.parseDiff(raw);

    const decision = decideCaseCreation({
      finding,
      reviewAgentId: agentId,
      agentExists,
      patch,
      diff,
    });
    if (!decision.ok) throw refusal(decision.code, REFUSAL_MESSAGES[decision.code]);
    // `decideCaseCreation` guarantees these.
    if (!agentId || raw === null) throw new Error('unreachable: decided case has no agent or diff');

    const baseName = caseNameFromTitle(finding.title);
    for (let attempt = 1; attempt <= MAX_CASE_NAME_ATTEMPTS; attempt++) {
      const names = await repo.agentCaseNames(workspaceId, agentId);
      const name = uniqueCaseName(baseName, new Set(names));
      const inserted = await repo.insertCase({
        workspaceId,
        agentId,
        sourceFindingId: finding.id,
        name,
        expectationType: decision.expectationType,
        expectation: {
          file: finding.file,
          start_line: finding.startLine,
          end_line: finding.endLine,
        },
        inputDiff: raw,
        inputFile: finding.file,
        inputMeta: { pr_title: pull.title, pr_description: capDescription(pull.body) },
        provenance: {
          finding_id: finding.id,
          review_id: review.id,
          pr_id: pull.id,
          pr_number: pull.number,
          repo_id: repoRef.id,
          repo_full_name: repoRef.fullName,
          decision: finding.acceptedAt ? 'accepted' : 'dismissed',
          decided_at: decision.decidedAt.toISOString(),
          agent_version: source.agentVersion,
          severity: finding.severity as Severity,
          category: finding.category as FindingCategory,
          title: finding.title,
        },
      });
      // `null`: a concurrent insert took the name; re-read the set and pick again (A17).
      if (inserted) return inserted;
    }
    throw new Error(`eval case name still taken after ${MAX_CASE_NAME_ATTEMPTS} attempts`);
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<void> {
    const deleted = await this.deps.repo.deleteCase(workspaceId, caseId);
    if (!deleted) throw new NotFoundError('Eval case not found');
  }

  /** POST /agents/:id/eval-runs — records the run, answers, then runs in the background. */
  async startRun(
    workspaceId: string,
    agentId: string,
    logger: EvalLogger,
  ): Promise<StartEvalRunResponse> {
    const { repo } = this.deps;
    const source = await repo.agentConfigSource(workspaceId, agentId);
    if (!source) throw new NotFoundError('Agent not found');

    const cases = await repo.casesForRun(workspaceId, agentId);
    if (cases.length === 0) throw refusal('no_eval_cases', REFUSAL_MESSAGES.no_eval_cases);

    const config = buildRunConfig(source);
    const refs: EvalRunCaseRef[] = cases.map((c) => ({
      case_id: c.id,
      revision_id: c.revisionId,
      revision: c.revision,
    }));
    const runId = await repo.createRun({
      workspaceId,
      agentId,
      agentVersion: config.agent_version,
      config,
      cases: refs,
    });
    if (runId === null) {
      throw refusal('eval_run_in_progress', REFUSAL_MESSAGES.eval_run_in_progress);
    }

    this.executeInBackground({
      workspaceId,
      runId,
      agentName: source.agent.name,
      config,
      cases,
      logger,
    });
    return { run_id: runId };
  }

  /**
   * POST /skills/:id/eval-runs — the skill's cases through its remembered
   * agent, the skill on inside this run's `config` only (`agent_skills` and
   * the agent row are never written). Every refusal precedes any write.
   */
  async startSkillRun(
    workspaceId: string,
    skillId: string,
    logger: EvalLogger,
  ): Promise<StartEvalRunResponse> {
    const { skills } = this.deps;
    const resolved = await resolveRunConfig(this.configPorts(), workspaceId, {
      kind: 'skill',
      id: skillId,
    });
    if (!resolved.skill) throw new Error('unreachable: a skill run resolved without its skill');

    const cases = await skills.casesForSkill(workspaceId, skillId);
    if (cases.length === 0) throw refusal('no_eval_cases', REFUSAL_MESSAGES.no_eval_cases);

    const { config } = resolved;
    const runId = await skills.createSkillRun({
      workspaceId,
      skillId,
      skillVersion: resolved.skill.version,
      viaAgentId: resolved.agentId,
      agentName: resolved.agentName,
      agentVersion: config.agent_version,
      config,
      cases: cases.map((c) => ({ case_id: c.id, revision_id: c.revisionId, revision: c.revision })),
    });
    if (runId === null) {
      throw refusal('eval_run_in_progress', REFUSAL_MESSAGES.eval_run_in_progress);
    }

    this.executeInBackground({
      workspaceId,
      runId,
      agentName: resolved.agentName,
      config,
      cases,
      logger,
    });
    return { run_id: runId };
  }

  async listSkillRuns(workspaceId: string, skillId: string): Promise<SkillEvalRunSummary[]> {
    await this.requireSkill(workspaceId, skillId);
    return this.deps.skills.listSkillRuns(workspaceId, skillId);
  }

  /** GET /skills/:id/eval-agent — the remembered agent, or the deleted one's name. */
  async getSkillEvalAgent(workspaceId: string, skillId: string): Promise<SkillEvalAgent> {
    await this.requireSkill(workspaceId, skillId);
    const row = await this.deps.skills.evalAgent(workspaceId, skillId);
    return {
      agent: row?.agentId ? { id: row.agentId, name: row.agentName } : null,
      missing_agent_name: row && !row.agentId ? row.agentName : null,
    };
  }

  /** PUT /skills/:id/eval-agent — remembered until changed (AC18); the agent must be this workspace's. */
  async setSkillEvalAgent(
    workspaceId: string,
    skillId: string,
    agentId: string,
  ): Promise<SkillEvalAgent> {
    const { skills } = this.deps;
    await this.requireSkill(workspaceId, skillId);
    const name = await skills.agentName(workspaceId, agentId);
    if (name === undefined) throw new NotFoundError('Agent not found');
    await skills.setEvalAgent(workspaceId, skillId, { id: agentId, name });
    return { agent: { id: agentId, name }, missing_agent_name: null };
  }

  async listRuns(workspaceId: string, agentId: string): Promise<AgentEvalRunSummary[]> {
    if (!(await this.deps.repo.agentExists(workspaceId, agentId))) {
      throw new NotFoundError('Agent not found');
    }
    return this.deps.repo.listRuns(workspaceId, agentId);
  }

  async getRun(workspaceId: string, runId: string): Promise<EvalRunDetail> {
    const run = await this.deps.repo.getRun(workspaceId, runId);
    if (!run) throw new NotFoundError('Eval run not found');
    return run;
  }

  /** Boot: close every run a dead process left `running`, by the same rule as a live close (AC17). */
  async reapStaleRuns(): Promise<number> {
    const { repo } = this.deps;
    const stale = await repo.runningRuns();
    for (const run of stale) {
      const finishedAt = (await repo.lastResultAt(run.id)) ?? run.startedAt;
      await this.close(run.id, run.startedAt, finishedAt, null, null);
    }
    return stale.length;
  }

  private async requireSkill(workspaceId: string, skillId: string): Promise<void> {
    if (!(await this.deps.skills.skillForRun(workspaceId, skillId))) {
      throw new NotFoundError('Skill not found');
    }
  }

  private configPorts(): RunConfigPorts {
    const { repo, skills } = this.deps;
    return {
      agentConfigSource: (ws, agentId) => repo.agentConfigSource(ws, agentId),
      skillForRun: (ws, skillId) => skills.skillForRun(ws, skillId),
      evalAgent: (ws, skillId) => skills.evalAgent(ws, skillId),
    };
  }

  /** Runs a recorded run after the answer; a crash closes it `failed` with the reason. */
  private executeInBackground(args: {
    workspaceId: string;
    runId: string;
    agentName: string;
    config: EvalRunConfig;
    cases: CaseForRun[];
    logger: EvalLogger;
  }): void {
    const { runId, logger } = args;
    const startedAt = this.now();
    void this.execute({ ...args, startedAt }).catch(async (err: unknown) => {
      logger.error({ eval_run_id: runId, reason: errorReason(err) }, 'eval run crashed');
      try {
        await this.close(runId, startedAt, this.now(), 'failed', errorReason(err));
      } catch (closeErr) {
        logger.error({ eval_run_id: runId, reason: errorReason(closeErr) }, 'eval run close failed');
      }
    });
  }

  private async execute(args: {
    workspaceId: string;
    runId: string;
    agentName: string;
    config: EvalRunConfig;
    cases: CaseForRun[];
    startedAt: Date;
    logger: EvalLogger;
  }): Promise<void> {
    const { workspaceId, runId, agentName, config, cases, startedAt, logger } = args;
    await mapWithConcurrency(cases, EVAL_CASE_CONCURRENCY, (c) =>
      this.runCase({ workspaceId, runId, agentName, config, case_: c, logger }),
    );
    await this.close(runId, startedAt, this.now(), null, null);
    logger.info({ eval_run_id: runId, cases: cases.length }, 'eval run closed');
  }

  private async runCase(args: {
    workspaceId: string;
    runId: string;
    agentName: string;
    config: EvalRunConfig;
    case_: CaseForRun;
    logger: EvalLogger;
  }): Promise<void> {
    const { workspaceId, runId, agentName, config, case_: c, logger } = args;
    const outcome = await runCaseReview(this.deps, config, c, {
      correlationId: runId,
      agentName,
      logger,
    });
    const result: CaseResultInsert = {
      workspaceId,
      evalRunId: runId,
      caseId: c.id,
      caseRevisionId: c.revisionId,
      caseName: c.name,
      expectationType: c.expectationType,
      expectation: c.expectation,
      ...outcome,
    };
    // Written after the engine returned: no external call inside the repository transaction.
    await this.deps.repo.insertCaseResult(result);
  }

  /** Aggregate the stored case results and close the run (AC17). `forceError` closes it failed. */
  private async close(
    runId: string,
    startedAt: Date,
    finishedAt: Date,
    forced: 'failed' | null,
    forceError: string | null,
  ): Promise<void> {
    const results = await this.deps.repo.runResults(runId);
    const agg = aggregateRun(results);
    const status = forced ?? agg.status;
    const values: RunClose = {
      status,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      casesScored: agg.casesScored,
      casesPassed: agg.casesPassed,
      recall: agg.recall,
      precision: agg.precision,
      citationAccuracy: agg.citationAccuracy,
      costUsd: agg.costUsd,
      error: forceError ?? (status === 'failed' ? 'no case was scored' : null),
    };
    await this.deps.repo.closeRun(runId, values);
  }
}

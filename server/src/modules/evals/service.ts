import { reviewPullRequest } from '@devdigest/reviewer-core';
import type {
  AgentEvalCaseListItem,
  AgentEvalRunDetail,
  AgentEvalRunSummary,
  CreateEvalCaseResponse,
  EvalErrorCode,
  EvalRunConfig,
  EvalRunCaseRef,
  FindingCategory,
  LLMProvider,
  Provider,
  Severity,
  StartEvalRunResponse,
  UnifiedDiff,
} from '@devdigest/shared';
import { aggregateRun, scoreCase } from '../../domain/evals/scoring.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import {
  createPromptMeasure,
  logPromptAssembled,
  type PromptLogMode,
} from '../../platform/prompt-log.js';
import { withTimeout } from '../../platform/resilience.js';
import {
  EVAL_CASE_CONCURRENCY,
  EVAL_CASE_TIMEOUT_MS,
  MAX_CASE_NAME_ATTEMPTS,
} from './constants.js';
import {
  buildRunConfig,
  capDescription,
  caseNameFromTitle,
  decideCaseCreation,
  errorReason,
  evalTaskLine,
  frozenDiff,
  mapWithConcurrency,
  skillBlocks,
  uniqueCaseName,
} from './helpers.js';
import type { EvalRepository } from './repository.js';
import type { CaseForRun, EvalLogger, RunClose } from './types.js';

/**
 * Narrow dependency set of the eval use cases: functions over the container's
 * facades and ports, never `Container` (server/INSIGHTS.md, 2026-09-22). The
 * container builds it.
 */
export interface EvalDeps {
  repo: Pick<
    EvalRepository,
    | 'findingForCase'
    | 'agentExists'
    | 'prFilePatch'
    | 'agentCaseNames'
    | 'insertCase'
    | 'listCases'
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
  llm: (provider: Provider) => Promise<LLMProvider>;
  /** Injected so the module needs no import of `adapters/git/diff-parser.ts`. */
  parseDiff: (raw: string) => UnifiedDiff;
  tokenizer: { count(text: string): number };
  /** Effective PROMPT_LOG mode: `off` skips the `prompt.assembled` record and its measuring. */
  promptLogMode: PromptLogMode;
  now?: () => Date;
}

/** Statuses of the closed set of refusals: everything is 422 except a run already in progress. */
function refusal(code: EvalErrorCode, message: string): AppError {
  return new AppError(code, message, code === 'eval_run_in_progress' ? 409 : 422);
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

  async listCases(workspaceId: string, agentId: string): Promise<AgentEvalCaseListItem[]> {
    if (!(await this.deps.repo.agentExists(workspaceId, agentId))) {
      throw new NotFoundError('Agent not found');
    }
    return this.deps.repo.listCases(workspaceId, agentId);
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

    const startedAt = this.now();
    void this.execute({
      workspaceId,
      runId,
      agentName: source.agent.name,
      config,
      cases,
      startedAt,
      logger,
    }).catch(async (err: unknown) => {
      logger.error({ eval_run_id: runId, reason: errorReason(err) }, 'eval run crashed');
      try {
        await this.close(runId, startedAt, this.now(), 'failed', errorReason(err));
      } catch (closeErr) {
        logger.error({ eval_run_id: runId, reason: errorReason(closeErr) }, 'eval run close failed');
      }
    });
    return { run_id: runId };
  }

  async listRuns(workspaceId: string, agentId: string): Promise<AgentEvalRunSummary[]> {
    if (!(await this.deps.repo.agentExists(workspaceId, agentId))) {
      throw new NotFoundError('Agent not found');
    }
    return this.deps.repo.listRuns(workspaceId, agentId);
  }

  async getRun(workspaceId: string, runId: string): Promise<AgentEvalRunDetail> {
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
    const { deps } = this;
    const started = Date.now();
    const base = {
      workspaceId,
      evalRunId: runId,
      caseId: c.id,
      caseRevisionId: c.revisionId,
      caseName: c.name,
      expectationType: c.expectationType,
      expectation: c.expectation,
    };

    let result: Parameters<EvalDeps['repo']['insertCaseResult']>[0];
    try {
      const llm = await deps.llm(config.provider);
      const promptLogMode = deps.promptLogMode;
      const outcome = await withTimeout(
        reviewPullRequest({
          systemPrompt: config.system_prompt,
          model: config.model,
          diff: deps.parseDiff(c.inputDiff),
          llm,
          strategy: config.strategy,
          skills: skillBlocks(config.skills),
          ...(c.inputMeta.pr_description ? { prDescription: c.inputMeta.pr_description } : {}),
          task: evalTaskLine(c.inputMeta.pr_title),
          sessionId: `eval:${runId}:${agentName}`,
          ...(promptLogMode !== 'off'
            ? {
                promptMeasure: createPromptMeasure(promptLogMode, deps.tokenizer),
                onPromptAssembled: (info) =>
                  logPromptAssembled(
                    logger,
                    {
                      component: 'reviewer',
                      provider: config.provider,
                      model: config.model,
                      correlation: { run_id: runId, agent: agentName },
                      review_mode: info.mode,
                      chunk: { index: info.chunkIndex, count: info.chunkCount },
                      sections: info.sections,
                    },
                    promptLogMode,
                  ),
              }
            : {}),
        }),
        EVAL_CASE_TIMEOUT_MS,
      );
      const findings = outcome.review.findings;
      const score = scoreCase(
        c.expectationType,
        c.expectation,
        findings,
        findings.length + outcome.dropped.length,
      );
      result = {
        ...base,
        status: score.status,
        error: null,
        findingsReturned: score.findingsReturned,
        findingsGrounded: score.findingsGrounded,
        findingsMatching: score.findingsMatching,
        recall: score.recall,
        precision: score.precision,
        citationAccuracy: score.citationAccuracy,
        durationMs: Date.now() - started,
        costUsd: outcome.costUsd,
        actualOutput: { findings },
      };
    } catch (err) {
      result = {
        ...base,
        status: 'errored',
        error: errorReason(err),
        findingsReturned: null,
        findingsGrounded: null,
        findingsMatching: null,
        recall: null,
        precision: null,
        citationAccuracy: null,
        durationMs: Date.now() - started,
        costUsd: null,
        actualOutput: null,
      };
    }
    // Written after the engine returned: no external call inside the repository transaction.
    await deps.repo.insertCaseResult(result);
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

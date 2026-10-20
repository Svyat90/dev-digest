import { validateCaseDraft } from '@devdigest/shared';
import type {
  AgentEvalCase,
  EvalCaseDetail,
  EvalCaseDraft,
  EvalCaseIssue,
  EvalCaseListItem,
  EvalCaseOwner,
  SaveEvalCaseResponse,
  StartEvalCaseCheckResponse,
} from '@devdigest/shared';
import {
  expectedOutputFromProvenance,
  pickLastRun,
  revisionContentChanged,
} from '../../domain/evals/case-editor.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type {
  ResolvedRunConfig,
  RevisionContent,
  StoredCase,
  StoredCaseView,
} from './editor-types.js';
import { errorReason, expectedCount } from './helpers.js';
import type { EvalCaseRepository } from './repository/case.repo.js';
import {
  resolveRunConfig,
  runCaseReview,
  type CaseRunnerDeps,
  type RunConfigPorts,
} from './run-executor.js';
import type { CaseForRun, EvalLogger } from './types.js';

/**
 * Case editor use cases (SPEC-06): list and open a case of either owner,
 * create and edit manual cases (content edit = new revision), single-case
 * runs and their boot reaping. Deps are narrow and structural, never
 * `Container` (server/INSIGHTS.md, 2026-09-22); the container builds them.
 */
export interface EvalCaseDeps {
  cases: Pick<
    EvalCaseRepository,
    | 'ownerName'
    | 'caseNames'
    | 'listCases'
    | 'getCase'
    | 'insertManualCase'
    | 'updateCase'
    | 'caseForRun'
    | 'startCheck'
    | 'finishCheck'
    | 'failRunningChecks'
  >;
  config: RunConfigPorts;
  runner: CaseRunnerDeps;
  now?: () => Date;
}

const RESTART_REASON = 'interrupted by a server restart';
const NAME_TAKEN: EvalCaseIssue = { field: 'name', code: 'name_taken', line: null, key: null };

function invalid(issues: EvalCaseIssue[]): AppError {
  return new AppError('eval_case_invalid', 'Eval case is invalid', 422, { issues });
}

function contentFixed(): AppError {
  return new AppError(
    'eval_case_content_fixed',
    'Created from a finding — input and expectation are fixed',
    422,
  );
}

function editConflict(): AppError {
  return new AppError(
    'eval_case_edit_conflict',
    'The case changed while you were editing — reopen it',
    409,
  );
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

function toDetail(view: StoredCaseView): EvalCaseDetail {
  const { stored } = view;
  const { content } = stored;
  return {
    ...toCase(stored),
    owner: stored.owner,
    origin: stored.provenance ? 'finding' : 'manual',
    input_diff: content.inputDiff,
    input_files: content.inputFiles,
    // A4: a finding-made revision stores no expected output; show it from provenance.
    expected_output:
      content.expectedOutput ??
      (stored.provenance
        ? expectedOutputFromProvenance(content.expectationType, content.expectation, stored.provenance)
        : []),
    latest_result: view.latestResult,
    check: view.check,
    last_run: pickLastRun(view.check, view.runResult),
  };
}

/** The draft's content as a revision; `inputFiles` and `expectedOutput` come from the caller. */
function draftContent(
  draft: EvalCaseDraft,
  inputFiles: string[],
  expectedOutput: RevisionContent['expectedOutput'],
): RevisionContent {
  return {
    inputDiff: draft.input_diff,
    inputFiles,
    inputMeta: { pr_title: draft.pr_title, pr_description: draft.pr_description },
    expectationType: draft.expectation_type,
    expectation: {
      file: draft.expectation.file,
      start_line: draft.expectation.start_line,
      end_line: draft.expectation.end_line,
    },
    expectedOutput,
  };
}

export class EvalCaseService {
  constructor(private deps: EvalCaseDeps) {}

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  /** Owner check first, before any validation, write or model call (AC24). */
  private async requireOwner(workspaceId: string, owner: EvalCaseOwner): Promise<void> {
    const name = await this.deps.cases.ownerName(workspaceId, owner);
    if (name === undefined) {
      throw new NotFoundError(owner.kind === 'agent' ? 'Agent not found' : 'Skill not found');
    }
  }

  private async requireCase(
    workspaceId: string,
    owner: EvalCaseOwner,
    caseId: string,
  ): Promise<StoredCaseView> {
    const view = await this.deps.cases.getCase(workspaceId, owner, caseId);
    if (!view) throw new NotFoundError('Eval case not found');
    return view;
  }

  async listCases(workspaceId: string, owner: EvalCaseOwner): Promise<EvalCaseListItem[]> {
    await this.requireOwner(workspaceId, owner);
    return this.deps.cases.listCases(workspaceId, owner);
  }

  async getCase(workspaceId: string, owner: EvalCaseOwner, caseId: string): Promise<EvalCaseDetail> {
    await this.requireOwner(workspaceId, owner);
    return toDetail(await this.requireCase(workspaceId, owner, caseId));
  }

  /** POST …/eval-cases — re-validates whatever the client sent; stored exactly as entered (AC9). */
  async createCase(
    workspaceId: string,
    owner: EvalCaseOwner,
    draft: EvalCaseDraft,
  ): Promise<SaveEvalCaseResponse> {
    await this.requireOwner(workspaceId, owner);
    const names = (await this.deps.cases.caseNames(workspaceId, owner)).map((c) => c.name);
    const check = validateCaseDraft(draft, names);
    if (check.issues.length > 0) throw invalid(check.issues);

    const caseId = await this.deps.cases.insertManualCase({
      workspaceId,
      owner,
      name: draft.name,
      content: draftContent(
        draft,
        check.diff.files.map((f) => f.path),
        check.expectedOutput,
      ),
    });
    // `null`: a concurrent save took the name; the index refused it and nothing was written (A1).
    if (caseId === null) throw invalid([NAME_TAKEN]);
    return {
      case: toDetail(await this.requireCase(workspaceId, owner, caseId)),
      revision_created: true,
    };
  }

  /**
   * PUT …/eval-cases/:caseId — a content change stores a new revision, a
   * name-only change none (AC11). A finding-made case may change its name only (AC10).
   */
  async updateCase(
    workspaceId: string,
    owner: EvalCaseOwner,
    caseId: string,
    draft: EvalCaseDraft,
  ): Promise<SaveEvalCaseResponse> {
    await this.requireOwner(workspaceId, owner);
    // The repository answers `conflict` for a missing row, so existence is checked here.
    const current = await this.requireCase(workspaceId, owner, caseId);
    const prev = current.stored.content;
    const otherNames = (await this.deps.cases.caseNames(workspaceId, owner))
      .filter((c) => c.id !== caseId)
      .map((c) => c.name);
    const check = validateCaseDraft(draft, otherNames);

    let content: RevisionContent | null;
    if (current.stored.provenance) {
      // A4: the JSON rules do not apply; the stored (absent) expected output stays.
      const next = draftContent(draft, prev.inputFiles, prev.expectedOutput);
      if (revisionContentChanged(prev, next)) throw contentFixed();
      const nameIssues = check.issues.filter((i) => i.field === 'name');
      if (nameIssues.length > 0) throw invalid(nameIssues);
      content = null;
    } else {
      if (check.issues.length > 0) throw invalid(check.issues);
      const next = draftContent(
        draft,
        check.diff.files.map((f) => f.path),
        check.expectedOutput,
      );
      content = revisionContentChanged(prev, next) ? next : null;
    }

    const outcome = await this.deps.cases.updateCase({
      workspaceId,
      caseId,
      name: draft.name,
      content,
    });
    if (outcome === 'conflict') throw editConflict();
    if (outcome === 'name_taken') throw invalid([NAME_TAKEN]);
    return {
      case: toDetail(await this.requireCase(workspaceId, owner, caseId)),
      revision_created: outcome === 'revised',
    };
  }

  /**
   * POST …/eval-cases/:caseId/check — opens the check and answers at once; the
   * review runs in the background (spec NFR Latency). Writes only
   * `eval_case_checks`, never a run or a run result (AC15).
   */
  async startCheck(
    workspaceId: string,
    owner: EvalCaseOwner,
    caseId: string,
    logger: EvalLogger,
  ): Promise<StartEvalCaseCheckResponse> {
    await this.requireOwner(workspaceId, owner);
    const c = await this.deps.cases.caseForRun(workspaceId, owner, caseId);
    if (!c) throw new NotFoundError('Eval case not found');
    const resolved = await resolveRunConfig(this.deps.config, workspaceId, owner);

    const checkId = await this.deps.cases.startCheck({
      workspaceId,
      caseId: c.id,
      caseRevisionId: c.revisionId,
      expected: expectedCount(c.expectationType),
    });
    if (checkId === null) {
      throw new AppError('eval_case_check_in_progress', 'A check of this case is already running', 409);
    }

    void this.runCheck(checkId, c, resolved, logger).catch(async (err: unknown) => {
      logger.error({ eval_case_check_id: checkId, reason: errorReason(err) }, 'eval case check crashed');
      try {
        await this.deps.cases.finishCheck(checkId, {
          status: 'errored',
          finishedAt: this.now(),
          durationMs: 0,
          got: null,
          error: errorReason(err),
          costUsd: null,
          findingsReturned: null,
          findingsGrounded: null,
          findingsMatching: null,
        });
      } catch (closeErr) {
        logger.error(
          { eval_case_check_id: checkId, reason: errorReason(closeErr) },
          'eval case check close failed',
        );
      }
    });
    return { check_id: checkId };
  }

  /** Boot: close every check a dead process left `running` (A11). */
  async reapStaleChecks(): Promise<number> {
    return this.deps.cases.failRunningChecks(RESTART_REASON, this.now());
  }

  private async runCheck(
    checkId: string,
    c: CaseForRun,
    resolved: ResolvedRunConfig,
    logger: EvalLogger,
  ): Promise<void> {
    const outcome = await runCaseReview(this.deps.runner, resolved.config, c, {
      correlationId: checkId,
      agentName: resolved.agentName,
      logger,
    });
    // Written after the engine returned: no external call inside a repository write.
    await this.deps.cases.finishCheck(checkId, {
      status: outcome.status,
      finishedAt: this.now(),
      durationMs: outcome.durationMs,
      got: outcome.findingsMatching,
      error: outcome.error,
      costUsd: outcome.costUsd,
      findingsReturned: outcome.findingsReturned,
      findingsGrounded: outcome.findingsGrounded,
      findingsMatching: outcome.findingsMatching,
    });
    logger.info({ eval_case_check_id: checkId, status: outcome.status }, 'eval case check closed');
  }
}

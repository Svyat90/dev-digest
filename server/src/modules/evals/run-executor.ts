import { reviewPullRequest } from '@devdigest/reviewer-core';
import type {
  EvalCaseOwner,
  EvalRunConfig,
  LLMProvider,
  Provider,
  UnifiedDiff,
} from '@devdigest/shared';
import { withSkillForRun } from '../../domain/evals/case-editor.js';
import { scoreCase } from '../../domain/evals/scoring.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import {
  createPromptMeasure,
  logPromptAssembled,
  type PromptLogMode,
} from '../../platform/prompt-log.js';
import { withTimeout } from '../../platform/resilience.js';
import { EVAL_CASE_TIMEOUT_MS } from './constants.js';
import type {
  CaseOutcome,
  ResolvedRunConfig,
  SkillEvalAgentRow,
  SkillForRun,
} from './editor-types.js';
import { buildRunConfig, errorReason, evalTaskLine, skillBlocks } from './helpers.js';
import type { AgentConfigSource, CaseForRun, EvalLogger } from './types.js';

/**
 * Per-case execution shared by full runs, skill runs and single-case runs
 * (SPEC-06). Deps are structural, never `Container` or the service, so the
 * service can import this file without a cycle (server/INSIGHTS.md, 2026-09-22).
 */
export interface CaseRunnerDeps {
  llm: (provider: Provider) => Promise<LLMProvider>;
  /** Injected so the module needs no import of `adapters/git/diff-parser.ts`. */
  parseDiff: (raw: string) => UnifiedDiff;
  tokenizer: { count(text: string): number };
  /** Effective PROMPT_LOG mode: `off` skips the `prompt.assembled` record and its measuring. */
  promptLogMode: PromptLogMode;
  now?: () => Date;
}

export interface CaseRunContext {
  /** The run or check id; goes to the session id and the prompt record's `run_id`. */
  correlationId: string;
  agentName: string;
  logger: EvalLogger;
}

/**
 * One case through the engine, scored. Never throws: any failure is an
 * `errored` outcome with the reason and unknown cost (AC14). Only the diff,
 * PR title and description reach the model, through the engine's untrusted
 * slots; the case name, notes and expected output never do (AC25).
 */
export async function runCaseReview(
  deps: CaseRunnerDeps,
  config: EvalRunConfig,
  c: CaseForRun,
  ctx: CaseRunContext,
): Promise<CaseOutcome> {
  const { correlationId, agentName, logger } = ctx;
  const started = Date.now();
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
        sessionId: `eval:${correlationId}:${agentName}`,
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
                    correlation: { run_id: correlationId, agent: agentName },
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
    return {
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
    return {
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
}

/** The reads `resolveRunConfig` needs; every one scoped by workspace. */
export interface RunConfigPorts {
  agentConfigSource(workspaceId: string, agentId: string): Promise<AgentConfigSource | undefined>;
  skillForRun(workspaceId: string, skillId: string): Promise<SkillForRun | undefined>;
  evalAgent(workspaceId: string, skillId: string): Promise<SkillEvalAgentRow | undefined>;
}

function agentMissing(agentName: string): AppError {
  return new AppError(
    'eval_agent_missing',
    "The skill's eval agent no longer exists",
    422,
    { agent_name: agentName },
  );
}

/**
 * The configuration a run of `owner` uses: the agent's own, or — for a skill —
 * the remembered agent's with the skill on for this run only (AC19). Every
 * refusal is thrown here, before any model call (AC24).
 */
export async function resolveRunConfig(
  ports: RunConfigPorts,
  workspaceId: string,
  owner: EvalCaseOwner,
): Promise<ResolvedRunConfig> {
  if (owner.kind === 'agent') {
    const source = await ports.agentConfigSource(workspaceId, owner.id);
    if (!source) throw new NotFoundError('Agent not found');
    return {
      config: buildRunConfig(source),
      agentId: source.agent.id,
      agentName: source.agent.name,
      skill: null,
    };
  }

  const skill = await ports.skillForRun(workspaceId, owner.id);
  if (!skill) throw new NotFoundError('Skill not found');
  const remembered = await ports.evalAgent(workspaceId, owner.id);
  if (!remembered) {
    throw new AppError('eval_agent_required', 'Choose an agent for this skill first', 422);
  }
  if (remembered.agentId === null) throw agentMissing(remembered.agentName);
  const source = await ports.agentConfigSource(workspaceId, remembered.agentId);
  if (!source) throw agentMissing(remembered.agentName);
  return {
    config: withSkillForRun(buildRunConfig(source), skill),
    agentId: source.agent.id,
    agentName: source.agent.name,
    skill: { id: skill.id, version: skill.version },
  };
}

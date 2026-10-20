import type {
  EvalCaseCheck,
  EvalCaseInputMeta,
  EvalCaseLastRun,
  EvalCaseLatestResult,
  EvalCaseOwner,
  EvalCaseProvenance,
  EvalExpectation,
  EvalExpectationType,
  EvalExpectedOutput,
  EvalRunCaseRef,
  EvalRunConfig,
} from '@devdigest/shared';

/**
 * Plain shapes of the case editor (SPEC-06) shared by the case and skill-eval
 * repositories, the run executor and the services. No zod and no imports
 * outside `@devdigest/shared`, so none of those files forms a cycle through it.
 */

/** The content of one case revision; a content edit stores a new revision. */
export interface RevisionContent {
  inputDiff: string;
  inputFiles: string[];
  inputMeta: EvalCaseInputMeta;
  expectationType: EvalExpectationType;
  expectation: EvalExpectation;
  /** Null for a revision of a case made from a finding (nothing was stored). */
  expectedOutput: EvalExpectedOutput | null;
}

/** A case of either owner at its current (highest) revision. */
export interface StoredCase {
  id: string;
  owner: EvalCaseOwner;
  name: string;
  /** Null for a manual case. */
  provenance: EvalCaseProvenance | null;
  createdAt: Date;
  revisionId: string;
  revision: number;
  content: RevisionContent;
}

/** A stored case with what its list row and editor show about past results. */
export interface StoredCaseView {
  stored: StoredCase;
  latestResult: EvalCaseLatestResult | null;
  /** The latest completed run's result, only when it covered the current revision. */
  runResult: EvalCaseLastRun | null;
  /** The newest single-case result of the current revision. */
  check: EvalCaseCheck | null;
}

/** A hand-written case: identity to `eval_cases`, content to revision 1. */
export interface NewManualCase {
  workspaceId: string;
  owner: EvalCaseOwner;
  name: string;
  content: RevisionContent;
}

/** A save of an existing case; `content` null = rename only (no revision). */
export interface CaseUpdate {
  workspaceId: string;
  caseId: string;
  name: string;
  content: RevisionContent | null;
}

/**
 * What a save did. `conflict` = another revision was written at the same time;
 * `name_taken` = the new name hit `eval_cases_owner_name_uq`. Neither writes anything.
 */
export type CaseUpdateOutcome = 'renamed' | 'revised' | 'conflict' | 'name_taken';

/** A single-case run starting over one revision. */
export interface CheckStart {
  workspaceId: string;
  caseId: string;
  caseRevisionId: string;
  expected: number;
}

/** What finishing a single-case run writes to its row. */
export interface CheckFinish {
  status: 'passed' | 'failed' | 'errored';
  finishedAt: Date;
  durationMs: number;
  got: number | null;
  error: string | null;
  costUsd: number | null;
  findingsReturned: number | null;
  findingsGrounded: number | null;
  findingsMatching: number | null;
}

/** The skill a skill eval run injects into the via agent's configuration. */
export interface SkillForRun {
  id: string;
  name: string;
  description: string;
  body: string;
  version: number;
}

/** The agent remembered for a skill; `agentId` null once that agent was deleted. */
export interface SkillEvalAgentRow {
  agentId: string | null;
  agentName: string;
}

/** A skill eval run to open: the skill's cases through one agent. */
export interface NewSkillRun {
  workspaceId: string;
  skillId: string;
  skillVersion: number;
  viaAgentId: string;
  agentName: string;
  agentVersion: number;
  config: EvalRunConfig;
  cases: EvalRunCaseRef[];
}

/** The configuration a run of either owner uses; `skill` set for skill runs. */
export interface ResolvedRunConfig {
  config: EvalRunConfig;
  agentId: string;
  agentName: string;
  skill: { id: string; version: number } | null;
}

/** The scored outcome of one case through the engine; never thrown. */
export interface CaseOutcome {
  status: 'passed' | 'failed' | 'errored';
  error: string | null;
  findingsReturned: number | null;
  findingsGrounded: number | null;
  findingsMatching: number | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number;
  costUsd: number | null;
  actualOutput: unknown;
}

import type {
  EvalCaseInputMeta,
  EvalCaseProvenance,
  EvalCaseResultStatus,
  EvalErrorCode,
  EvalExpectation,
  EvalExpectationType,
  EvalRunCaseRef,
  EvalRunConfig,
  Provider,
  ReviewStrategy,
  UnifiedDiff,
} from '@devdigest/shared';

/**
 * Plain shapes shared by the evals module's files. No zod and no imports
 * outside `@devdigest/shared`, so helpers, repository and service can import
 * this without a cycle.
 */

/** A finding with the facts needed to turn it into an eval case. */
export interface FindingForCase {
  finding: {
    id: string;
    file: string;
    startLine: number;
    endLine: number;
    kind: string;
    severity: string;
    category: string;
    title: string;
    acceptedAt: Date | null;
    dismissedAt: Date | null;
  };
  review: { id: string; agentId: string | null; runId: string | null };
  pull: { id: string; number: number; title: string; body: string | null };
  repo: { id: string; fullName: string };
  /** Agent version from the source run's trace; null when there is none. */
  agentVersion: number | null;
}

/** A new case: identity fields go to `eval_cases`, content fields to revision 1. */
export interface NewEvalCase {
  workspaceId: string;
  agentId: string;
  sourceFindingId: string;
  name: string;
  expectationType: EvalExpectationType;
  expectation: EvalExpectation;
  inputDiff: string;
  inputFile: string;
  inputMeta: EvalCaseInputMeta;
  provenance: EvalCaseProvenance;
}

/** A case at its current revision, as a run consumes it. */
export interface CaseForRun {
  id: string;
  revisionId: string;
  revision: number;
  name: string;
  expectationType: EvalExpectationType;
  expectation: EvalExpectation;
  inputDiff: string;
  inputMeta: EvalCaseInputMeta;
}

/** The agent row and its linked skills (in link order) a run snapshots. */
export interface AgentConfigSource {
  agent: {
    id: string;
    name: string;
    version: number;
    provider: Provider;
    model: string;
    systemPrompt: string;
    strategy: ReviewStrategy;
  };
  skills: {
    id: string;
    name: string;
    description: string;
    body: string;
    version: number;
    order: number;
    linkEnabled: boolean;
    skillEnabled: boolean;
  }[];
}

export interface NewEvalRun {
  workspaceId: string;
  agentId: string;
  agentVersion: number;
  config: EvalRunConfig;
  cases: EvalRunCaseRef[];
}

/** One per-case result row to store. */
export interface CaseResultInsert {
  workspaceId: string;
  evalRunId: string;
  caseId: string;
  caseRevisionId: string;
  caseName: string;
  expectationType: EvalExpectationType;
  expectation: EvalExpectation;
  status: EvalCaseResultStatus;
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

/** What closing a run writes to its row. */
export interface RunClose {
  status: 'completed' | 'failed';
  finishedAt: Date;
  durationMs: number | null;
  casesScored: number;
  casesPassed: number;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  costUsd: number | null;
  error: string | null;
}

/** Inputs of the pure "may this finding become a case" decision. */
export interface CaseCreationInput {
  finding: FindingForCase['finding'];
  reviewAgentId: string | null;
  agentExists: boolean;
  patch: string | null;
  diff: UnifiedDiff | null;
}

export type CaseCreationDecision =
  | { ok: true; expectationType: EvalExpectationType; decidedAt: Date }
  | { ok: false; code: EvalErrorCode };

/** The slice of the Fastify logger the module uses; never given diff or prompt text. */
export interface EvalLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

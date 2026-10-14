import type { AgentEvalRunSummary, EvalRunStatus } from '@devdigest/shared';

/**
 * Structural row shape the mapper needs. Declared locally (not imported from a
 * repository) so helpers and repositories never form an import cycle.
 */
export interface SuiteRunRowLike {
  id: string;
  agentId: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  agentVersion: number;
  casesTotal: number;
  casesDone: number;
  casesScored: number;
  casesPassed: number;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  costUsd: number | null;
  error: string | null;
}

/** Row -> contract. A `null` cost stays `null` (unknown), never `0`. */
export function toRunSummary(row: SuiteRunRowLike): AgentEvalRunSummary {
  return {
    id: row.id,
    agent_id: row.agentId,
    status: row.status as EvalRunStatus,
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

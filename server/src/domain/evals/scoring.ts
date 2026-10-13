/**
 * Eval scoring: matching a finding against an expectation, the per-case score
 * and the pooled run aggregate.
 *
 * Pure on purpose (`domain-is-pure`): nothing here can reach a model, so
 * scoring a run never spends a request. Metrics are POOLED counts over scored
 * (non-errored) cases, never an average of per-case values. Cost `null` means
 * "unknown", never `0`.
 */
import type {
  EvalExpectation,
  EvalExpectationType,
  EvalRunRecord,
  Finding,
} from '@devdigest/shared';

type Located = Pick<Finding, 'file' | 'start_line' | 'end_line'>;

export function normalizePath(path: string): string {
  return path.trim().replace(/^\.\//, '');
}

/** Same file (after normalisation) and line ranges that overlap, ends included. */
export function findingMatches(finding: Located, expectation: EvalExpectation): boolean {
  if (normalizePath(finding.file) !== normalizePath(expectation.file)) return false;
  const aLo = Math.min(finding.start_line, finding.end_line);
  const aHi = Math.max(finding.start_line, finding.end_line);
  const bLo = Math.min(expectation.start_line, expectation.end_line);
  const bHi = Math.max(expectation.start_line, expectation.end_line);
  return Math.max(aLo, bLo) <= Math.min(aHi, bHi);
}

export interface CaseScore {
  status: 'passed' | 'failed';
  findingsReturned: number;
  findingsGrounded: number;
  findingsMatching: number;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
}

function ratio(num: number, den: number): number | null {
  return den === 0 ? null : num / den;
}

export function scoreCase(
  type: EvalExpectationType,
  expectation: EvalExpectation,
  grounded: Located[],
  returnedCount: number,
): CaseScore {
  const matching = grounded.filter((f) => findingMatches(f, expectation)).length;
  const noise = type === 'must_not_flag' ? matching : 0;
  const passed = type === 'must_find' ? matching >= 1 : matching === 0;
  return {
    status: passed ? 'passed' : 'failed',
    findingsReturned: returnedCount,
    findingsGrounded: grounded.length,
    findingsMatching: matching,
    recall: type === 'must_find' ? (matching >= 1 ? 1 : 0) : null,
    precision: ratio(grounded.length - noise, grounded.length),
    citationAccuracy: ratio(grounded.length, returnedCount),
  };
}

export interface RunAggregate {
  status: 'completed' | 'failed';
  casesScored: number;
  casesPassed: number;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  costUsd: number | null;
}

export function aggregateRun(
  results: Pick<
    EvalRunRecord,
    | 'status'
    | 'expectation_type'
    | 'findings_returned'
    | 'findings_grounded'
    | 'findings_matching'
    | 'cost_usd'
  >[],
): RunAggregate {
  const scored = results.filter((r) => r.status !== 'errored');
  const mustFind = scored.filter((r) => r.expectation_type === 'must_find');
  const matchedMustFind = mustFind.filter((r) => (r.findings_matching ?? 0) >= 1).length;

  let returned = 0;
  let grounded = 0;
  let noise = 0;
  for (const r of scored) {
    returned += r.findings_returned ?? 0;
    grounded += r.findings_grounded ?? 0;
    if (r.expectation_type === 'must_not_flag') noise += r.findings_matching ?? 0;
  }

  const costs = results.map((r) => r.cost_usd).filter((c): c is number => c !== null);

  return {
    status: scored.length > 0 ? 'completed' : 'failed',
    casesScored: scored.length,
    casesPassed: results.filter((r) => r.status === 'passed').length,
    recall: ratio(matchedMustFind, mustFind.length),
    precision: ratio(grounded - noise, grounded),
    citationAccuracy: ratio(grounded, returned),
    costUsd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
  };
}

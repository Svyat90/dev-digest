/**
 * Eval dashboard rules: range start, whole-point comparison, case-set
 * difference by revision, the regression alert and the trend cap.
 *
 * Pure on purpose (`domain-is-pure`): the current time is a parameter and
 * nothing here can reach a model. Every metric comparison uses whole percent
 * points, never raw fractions.
 */
import type {
  EvalCaseSetDiff,
  EvalDashboardRange,
  EvalMetricDirection,
  EvalMetricKey,
  EvalRegressionAlert,
  EvalRunCaseRef,
} from '@devdigest/shared';

export const TREND_POINT_CAP = 200;
export const RECENT_RUNS_LIMIT = 20;
export const RECALL_SPARKLINE_DAYS = 30;

const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<Exclude<EvalDashboardRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** Start of the range, or `null` for "all". */
export function rangeStart(range: EvalDashboardRange, now: Date): Date | null {
  if (range === 'all') return null;
  return new Date(now.getTime() - RANGE_DAYS[range] * DAY_MS);
}

/** A 0..1 metric in whole percent points; `null` stays `null`. */
export function toPoints(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100);
}

/**
 * Keyed by revision id: one case covered at two revisions counts as one
 * removed and one added (SPEC-06 AC12).
 */
export function caseSetDiff(
  earlier: readonly EvalRunCaseRef[],
  later: readonly EvalRunCaseRef[],
): EvalCaseSetDiff {
  const before = new Set(earlier.map((c) => c.revision_id));
  const after = new Set(later.map((c) => c.revision_id));
  let added = 0;
  let removed = 0;
  for (const id of after) if (!before.has(id)) added += 1;
  for (const id of before) if (!after.has(id)) removed += 1;
  return { added, removed };
}

export interface AlertRun {
  id: string;
  agent_version: number;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  cases: readonly EvalRunCaseRef[];
}

/** Tie-break order for the largest drop. */
const METRICS: readonly EvalMetricKey[] = ['recall', 'precision', 'citation_accuracy'];

export function buildRegressionAlert(
  latest: AlertRun | null,
  previous: AlertRun | null,
): EvalRegressionAlert | null {
  if (!latest || !previous) return null;

  const compared: { metric: EvalMetricKey; delta: number }[] = [];
  for (const metric of METRICS) {
    const now = toPoints(latest[metric]);
    const before = toPoints(previous[metric]);
    if (now === null || before === null) continue;
    compared.push({ metric, delta: now - before });
  }

  let worst: { metric: EvalMetricKey; delta: number } | null = null;
  for (const c of compared) {
    if (c.delta <= -1 && (worst === null || c.delta < worst.delta)) worst = c;
  }
  if (!worst) return null;

  const top = worst;
  const direction = (delta: number): EvalMetricDirection =>
    delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';

  return {
    metric: top.metric,
    drop_points: -top.delta,
    agent_version: latest.agent_version,
    run_id: latest.id,
    previous_run_id: previous.id,
    others: compared
      .filter((c) => c.metric !== top.metric)
      .map((c) => ({ metric: c.metric, direction: direction(c.delta) })),
    case_sets: caseSetDiff(previous.cases, latest.cases),
  };
}

/** Keeps the newest `cap` of a newest-first list and returns them oldest first. */
export function capTrend<T>(
  newestFirst: readonly T[],
  cap: number,
): { points: T[]; truncated: boolean } {
  return {
    points: newestFirst.slice(0, cap).reverse(),
    truncated: newestFirst.length > cap,
  };
}

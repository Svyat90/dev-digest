import type { FindingsBySeverity, PrStatus } from '@devdigest/shared';

/**
 * PR-list rollup helpers (pure — no DB / `this`, so they unit-test cleanly).
 *
 * The Pull Requests list shows, per PR: the latest review's SCORE, a FINDINGS
 * severity breakdown, and a review STATUS. The DB `status` column holds
 * GitHub's merge state (open/merged/closed); the review status
 * (needs_review / reviewed / stale) is DERIVED here for OPEN PRs from the
 * commit a review last ran against (`lastReviewedSha`) vs the PR head, plus age.
 */

/** Open PRs whose current head was reviewed but untouched this long read "stale". */
export const STALE_DAYS = 7;

const SEVERITY_KEYS: readonly (keyof FindingsBySeverity)[] = ['CRITICAL', 'WARNING', 'SUGGESTION'];

/** A tally with every bucket at zero — "reviewed and clean", NOT "unknown". */
export function emptySeverityCounts(): FindingsBySeverity {
  return { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
}

/**
 * Fold `GROUP BY pr_id, severity` rows into one tally per PR.
 *
 * `severity` is a plain text column, so a row can carry anything: an unknown
 * value is DROPPED rather than crashing or silently landing in a bucket it does
 * not belong to. A PR that appears in no row is absent from the map — the
 * caller decides whether that means "clean" or "never reviewed", because only
 * it knows whether the PR has a review at all.
 */
export function foldSeverityCounts(
  rows: { prId: string; severity: string; n: number }[],
): Map<string, FindingsBySeverity> {
  const byPr = new Map<string, FindingsBySeverity>();
  for (const row of rows) {
    const key = row.severity as keyof FindingsBySeverity;
    if (!SEVERITY_KEYS.includes(key)) continue;
    let counts = byPr.get(row.prId);
    if (!counts) {
      counts = emptySeverityCounts();
      byPr.set(row.prId, counts);
    }
    counts[key] += row.n;
  }
  return byPr;
}

/**
 * Review-freshness status for the PR list. Merged/closed PRs keep their GitHub
 * merge state; open PRs map to:
 *  - `needs_review` — never reviewed, OR head moved since the last review
 *  - `stale`        — current head was reviewed but the PR is older than STALE_DAYS
 *  - `reviewed`     — current head reviewed and recent
 */
export function deriveReviewStatus(args: {
  /** DB `status` column = GitHub merge state (open/merged/closed). */
  ghStatus: string;
  lastReviewedSha: string | null;
  headSha: string;
  updatedAt: Date | null;
  now: number;
  staleDays?: number;
}): PrStatus {
  const { ghStatus, lastReviewedSha, headSha, updatedAt, now } = args;
  if (ghStatus === 'merged' || ghStatus === 'closed') return ghStatus as PrStatus;
  if (!lastReviewedSha || lastReviewedSha !== headSha) return 'needs_review';
  const staleMs = (args.staleDays ?? STALE_DAYS) * 86_400_000;
  if (updatedAt && now - updatedAt.getTime() > staleMs) return 'stale';
  return 'reviewed';
}

/**
 * Coerce a SQL aggregate's value into a cost.
 *
 * Drizzle types `sum()` as `string | null` even over a double-precision column,
 * and postgres.js may hand back either a string or a number — so both are
 * accepted. NULL must survive as null: `Number(null)` is 0, which would report
 * a PR whose every run is unpriced as free. That distinction (unknown vs free)
 * is the one this column keeps getting wrong, so it lives in one tested place.
 */
export function parseAggregateCost(value: string | number | null): number | null {
  return value == null ? null : Number(value);
}

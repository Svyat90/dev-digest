/**
 * PR-list rollup helpers (`modules/pulls/status.ts`) — the pure derivation that
 * decides each PR's review STATUS and tallies its FINDINGS for the list. The DB
 * `status` column holds GitHub's merge state; the review status
 * (needs_review / reviewed / stale) is derived here from head vs lastReviewedSha
 * + age, so it gets unit coverage independent of the route's queries.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveReviewStatus,
  rollupSeverities,
  rollupLatestRoundCost,
  STALE_DAYS,
  type RunCostRow,
} from '../src/modules/pulls/status.js';

const DAY = 86_400_000;
const now = Date.UTC(2026, 5, 11);

describe('deriveReviewStatus', () => {
  it('needs_review when never reviewed, or when head moved since the last review', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: null, headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'old', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
  });

  it('reviewed when the current head was reviewed and the PR is recent', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now - DAY), now }),
    ).toBe('reviewed');
  });

  it('stale when the current head was reviewed but the PR is older than STALE_DAYS', () => {
    expect(
      deriveReviewStatus({
        ghStatus: 'open',
        lastReviewedSha: 'abc',
        headSha: 'abc',
        updatedAt: new Date(now - (STALE_DAYS + 1) * DAY),
        now,
      }),
    ).toBe('stale');
  });

  it('keeps merged/closed regardless of review state', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'merged', lastReviewedSha: null, headSha: 'abc', updatedAt: null, now }),
    ).toBe('merged');
    expect(
      deriveReviewStatus({ ghStatus: 'closed', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('closed');
  });
});

describe('rollupSeverities', () => {
  it('tallies findings into critical / warning / suggestion buckets (ignores unknown)', () => {
    expect(
      rollupSeverities([
        { severity: 'CRITICAL' },
        { severity: 'CRITICAL' },
        { severity: 'WARNING' },
        { severity: 'SUGGESTION' },
        { severity: 'WEIRD' },
      ]),
    ).toEqual({ critical: 2, warning: 1, suggestion: 1 });
  });

  it('is all-zero for no findings', () => {
    expect(rollupSeverities([])).toEqual({ critical: 0, warning: 0, suggestion: 0 });
  });
});

/**
 * The COST column totals a review ROUND. Regression guard for the bug where a
 * three-reviewer round reported only its newest reviewer's spend.
 */
describe('rollupLatestRoundCost', () => {
  // Newest-first, as the route's `orderBy(desc(ranAt))` delivers them.
  const row = (o: Partial<RunCostRow>): RunCostRow => ({
    prId: 'pr-1',
    roundId: 'round-1',
    costUsd: 0.001,
    ...o,
  });

  it('sums every reviewer of the latest round, not just the newest one', () => {
    // The exact shape from the bug report: three agents, one round.
    const out = rollupLatestRoundCost([
      row({ costUsd: 0.00015 }),
      row({ costUsd: 0.00022 }),
      row({ costUsd: 0.000034 }),
    ]);
    expect(out.get('pr-1')).toBeCloseTo(0.000404, 9);
  });

  it('ignores runs from an older round', () => {
    const out = rollupLatestRoundCost([
      row({ costUsd: 0.0002 }),
      row({ costUsd: 0.0001 }),
      row({ roundId: 'round-0', costUsd: 99 }),
    ]);
    expect(out.get('pr-1')).toBeCloseTo(0.0003, 9);
  });

  it('sums only the known costs when a round mixes priced and unpriced models', () => {
    const out = rollupLatestRoundCost([
      row({ costUsd: null }), // newest run is the unpriced one
      row({ costUsd: 0.0013 }),
      row({ costUsd: 0.00034 }),
    ]);
    expect(out.get('pr-1')).toBeCloseTo(0.00164, 9);
  });

  it('reports an entirely unpriced round as unknown, not as zero', () => {
    const out = rollupLatestRoundCost([row({ costUsd: null }), row({ costUsd: null })]);
    expect(out.get('pr-1')).toBeNull();
  });

  it('counts a free model as a real zero', () => {
    const out = rollupLatestRoundCost([row({ costUsd: 0 })]);
    expect(out.get('pr-1')).toBe(0);
  });

  it('treats a run with no round as a round of one', () => {
    const out = rollupLatestRoundCost([
      row({ roundId: null, costUsd: 0.005 }),
      row({ roundId: 'round-1', costUsd: 99 }),
    ]);
    expect(out.get('pr-1')).toBe(0.005);
  });

  it('keeps PRs apart and drops rows whose PR was detached', () => {
    const out = rollupLatestRoundCost([
      row({ prId: 'pr-1', costUsd: 0.001 }),
      row({ prId: 'pr-2', roundId: 'round-2', costUsd: 0.002 }),
      row({ prId: null, costUsd: 99 }),
    ]);
    expect(out.get('pr-1')).toBe(0.001);
    expect(out.get('pr-2')).toBe(0.002);
    expect(out.size).toBe(2);
  });

  it('has no entry for a PR with no completed runs', () => {
    expect(rollupLatestRoundCost([]).get('pr-1')).toBeUndefined();
  });
});

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
  emptySeverityCounts,
  foldSeverityCounts,
  parseAggregateCost,
  STALE_DAYS,
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

describe('foldSeverityCounts', () => {
  it('folds GROUP BY rows into one tally per PR, keeping PRs apart', () => {
    const byPr = foldSeverityCounts([
      { prId: 'a', severity: 'CRITICAL', n: 2 },
      { prId: 'a', severity: 'WARNING', n: 1 },
      { prId: 'b', severity: 'SUGGESTION', n: 5 },
    ]);
    expect(byPr.get('a')).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 0 });
    expect(byPr.get('b')).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 5 });
  });

  it('drops an unknown severity instead of crashing or inflating a bucket', () => {
    // `findings.severity` is a plain text column — nothing stops a stray value.
    const byPr = foldSeverityCounts([
      { prId: 'a', severity: 'WEIRD', n: 3 },
      { prId: 'a', severity: 'CRITICAL', n: 1 },
    ]);
    expect(byPr.get('a')).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
  });

  it('leaves a PR with no rows OUT of the map — the caller decides what that means', () => {
    // Absent is not the same as zero: only the route knows whether the PR has
    // a review at all (clean) or has never been reviewed (unknown).
    expect(foldSeverityCounts([]).has('a')).toBe(false);
  });

  it('hands out a fresh zero tally each call — never a shared object', () => {
    const one = emptySeverityCounts();
    one.CRITICAL += 1;
    expect(emptySeverityCounts()).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });
});

describe('parseAggregateCost', () => {
  it('keeps an absent aggregate absent — NOT zero', () => {
    // SUM() over rows that are all NULL yields NULL. Number(null) is 0, which
    // would tell the user an unpriced PR was free.
    expect(parseAggregateCost(null)).toBeNull();
  });

  it('reads the string Drizzle types sum() as', () => {
    expect(parseAggregateCost('0.0022')).toBeCloseTo(0.0022, 9);
  });

  it('passes a number straight through, zero included', () => {
    expect(parseAggregateCost(0.0022)).toBeCloseTo(0.0022, 9);
    expect(parseAggregateCost(0)).toBe(0); // a free model really did cost 0
  });
});

import { describe, it, expect } from 'vitest';
import {
  buildRegressionAlert,
  capTrend,
  caseSetDiff,
  rangeStart,
  toPoints,
  type AlertRun,
} from '../src/domain/evals/dashboard.js';

const refs = (ids: string[]) => ids.map((id) => ({ case_id: id.split('@')[0]!, revision_id: id, revision: 1 }));
const run = (id: string, m: Partial<AlertRun> = {}): AlertRun => ({
  id,
  agent_version: 3,
  recall: 0.8,
  precision: 0.8,
  citation_accuracy: 0.8,
  cases: [],
  ...m,
});

describe('buildRegressionAlert', () => {
  it('reports the dropped metric and the others as up', () => {
    const a = buildRegressionAlert(
      run('b', { precision: 0.78, recall: 0.9, citation_accuracy: 0.85, agent_version: 4 }),
      run('a'),
    );
    expect(a).toMatchObject({
      metric: 'precision',
      drop_points: 2,
      agent_version: 4,
      run_id: 'b',
      previous_run_id: 'a',
      others: [
        { metric: 'recall', direction: 'up' },
        { metric: 'citation_accuracy', direction: 'up' },
      ],
    });
  });

  it('skips a metric with no value in both runs', () => {
    const a = buildRegressionAlert(
      run('b', { precision: null, recall: 0.79 }),
      run('a'),
    );
    expect(a?.metric).toBe('recall');
    expect(a?.drop_points).toBe(1);
  });

  it('returns null when nothing dropped by a whole point', () => {
    expect(
      buildRegressionAlert(
        run('b', { recall: null, precision: 0.776 }),
        run('a', { recall: null, precision: 0.784 }),
      ),
    ).toBeNull();
    expect(buildRegressionAlert(null, run('a'))).toBeNull();
  });

  it('breaks ties in the order recall, precision, citation', () => {
    const a = buildRegressionAlert(
      run('b', { recall: 0.77, precision: 0.77 }),
      run('a'),
    );
    expect(a?.metric).toBe('recall');
  });
});

describe('caseSetDiff', () => {
  it('counts added ids', () => {
    const base = Array.from({ length: 18 }, (_, i) => `c${i}@1`);
    expect(caseSetDiff(refs(base), refs([...base, 'x@1', 'y@1']))).toEqual({ added: 2, removed: 0 });
  });

  it('counts a case at a new revision as one removed and one added', () => {
    expect(caseSetDiff(refs(['a@1', 'b@1']), refs(['a@1', 'b@2']))).toEqual({ added: 1, removed: 1 });
  });
});

describe('capTrend / rangeStart / toPoints', () => {
  it('caps newest-first input and returns oldest first', () => {
    const items = Array.from({ length: 201 }, (_, i) => i);
    const { points, truncated } = capTrend(items, 200);
    expect(points).toHaveLength(200);
    expect(points[0]).toBe(199);
    expect(points[199]).toBe(0);
    expect(truncated).toBe(true);
    expect(capTrend([1, 2], 200).truncated).toBe(false);
  });

  it('computes the range start', () => {
    const now = new Date('2026-10-13T00:00:00Z');
    expect(rangeStart('all', now)).toBeNull();
    expect(rangeStart('7d', now)?.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(toPoints(0.784)).toBe(78);
    expect(toPoints(null)).toBeNull();
  });
});

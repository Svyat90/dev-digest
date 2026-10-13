import { describe, it, expect } from 'vitest';
import {
  aggregateRun,
  findingMatches,
  normalizePath,
  scoreCase,
} from '../src/domain/evals/scoring.js';

const exp = { file: 'src/a.ts', start_line: 10, end_line: 12 };
const at = (file: string, s: number, e: number) => ({ file, start_line: s, end_line: e });

describe('findingMatches', () => {
  it('ignores a leading ./ and surrounding whitespace on both sides', () => {
    expect(normalizePath(' ./src/a.ts ')).toBe('src/a.ts');
    expect(findingMatches(at('./src/a.ts', 10, 10), exp)).toBe(true);
    expect(findingMatches(at(' src/a.ts ', 10, 10), { ...exp, file: './src/a.ts' })).toBe(true);
  });

  it('treats range ends as inclusive', () => {
    expect(findingMatches(at('src/a.ts', 12, 20), exp)).toBe(true);
    expect(findingMatches(at('src/a.ts', 13, 20), exp)).toBe(false);
    expect(findingMatches(at('src/b.ts', 10, 12), exp)).toBe(false);
  });
});

describe('scoreCase', () => {
  it('must_not_flag passes with a finding elsewhere in the same file and adds no noise', () => {
    const s = scoreCase('must_not_flag', exp, [at('src/a.ts', 50, 60)], 1);
    expect(s.status).toBe('passed');
    expect(s.findingsMatching).toBe(0);
    expect(s.precision).toBe(1);
    expect(s.recall).toBeNull();
  });

  it('must_find fails with no matching finding', () => {
    const s = scoreCase('must_find', exp, [at('src/a.ts', 50, 60)], 2);
    expect(s).toMatchObject({ status: 'failed', findingsMatching: 0, recall: 0, citationAccuracy: 0.5 });
  });
});

type Row = Parameters<typeof aggregateRun>[0][number];
const row = (r: Partial<Row>): Row => ({
  status: 'passed',
  expectation_type: 'must_find',
  findings_returned: 0,
  findings_grounded: 0,
  findings_matching: 0,
  cost_usd: null,
  ...r,
});

describe('aggregateRun', () => {
  it('pools counts over scored cases and sums known costs', () => {
    const agg = aggregateRun([
      row({ status: 'passed', findings_returned: 2, findings_grounded: 1, findings_matching: 1, cost_usd: 0.01 }),
      row({ status: 'failed', findings_returned: 1, findings_grounded: 0, findings_matching: 0, cost_usd: 0.02 }),
      row({
        status: 'failed',
        expectation_type: 'must_not_flag',
        findings_returned: 1,
        findings_grounded: 2,
        findings_matching: 1,
      }),
      row({ status: 'errored', findings_returned: null, findings_grounded: null, findings_matching: null }),
    ]);
    expect(agg.status).toBe('completed');
    expect(agg.casesScored).toBe(3);
    expect(agg.casesPassed).toBe(1);
    expect(agg.recall).toBe(0.5);
    expect(agg.precision).toBeCloseTo(2 / 3);
    expect(agg.citationAccuracy).toBe(3 / 4);
    expect(agg.costUsd).toBeCloseTo(0.03);
  });

  it('only must_not_flag cases give a null recall', () => {
    const agg = aggregateRun([row({ expectation_type: 'must_not_flag' })]);
    expect(agg.recall).toBeNull();
    expect(agg.status).toBe('completed');
  });

  it('no findings anywhere gives null precision and citation', () => {
    const agg = aggregateRun([row({ status: 'failed' })]);
    expect(agg.precision).toBeNull();
    expect(agg.citationAccuracy).toBeNull();
  });

  it('all errored is failed with null metrics and null cost', () => {
    const agg = aggregateRun([row({ status: 'errored' }), row({ status: 'errored' })]);
    expect(agg).toEqual({
      status: 'failed',
      casesScored: 0,
      casesPassed: 0,
      recall: null,
      precision: null,
      citationAccuracy: null,
      costUsd: null,
    });
  });
});

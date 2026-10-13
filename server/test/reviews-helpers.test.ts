import { describe, it, expect } from 'vitest';
import { reviewToDto, taskLine } from '../src/modules/reviews/helpers.js';

/**
 * Unit coverage for the review task-line. The key invariant: our trusted
 * instruction always tells the model to review the whole diff and never
 * withhold a security/correctness finding — no matter what the PR text claims.
 */

describe('taskLine', () => {
  const pull = { number: 3, title: 'test: vulnerable fixture', author: 'burnjohn' } as never;

  it('names the PR being reviewed', () => {
    const line = taskLine(pull);
    expect(line).toContain('#3');
    expect(line).toContain('test: vulnerable fixture');
  });

  it('keeps the non-negotiable "never withhold security" rule', () => {
    const line = taskLine(pull);
    expect(line).toMatch(/never .*withhold .*(or downgrade )?.*security/i);
    expect(line).toMatch(/review the entire diff/i);
  });
});

describe('reviewToDto eval_case_id', () => {
  const finding = (id: string) =>
    ({
      id,
      reviewId: 'r1',
      severity: 'high',
      category: 'security',
      title: 't',
      file: 'a.ts',
      startLine: 1,
      endLine: 2,
      rationale: 'r',
      suggestion: null,
      confidence: 0.9,
      kind: 'finding',
      trifectaComponents: null,
      acceptedAt: null,
      dismissedAt: null,
    }) as never;
  const review = { id: 'r1', prId: 'p1', agentId: null, runId: null, kind: 'review', createdAt: new Date() } as never;

  it('sets eval_case_id from the map and null otherwise', () => {
    const dto = reviewToDto(review, [finding('f1'), finding('f2')], null, new Map([['f1', 'c1']]));
    expect(dto.findings.map((f) => f.eval_case_id)).toEqual(['c1', null]);
  });

  it('is null for every finding without a map', () => {
    const dto = reviewToDto(review, [finding('f1')]);
    expect(dto.findings[0]!.eval_case_id).toBeNull();
  });
});

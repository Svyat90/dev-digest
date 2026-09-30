import { describe, expect, it } from 'vitest';
import type { FindingLite, ReviewLite, RunState } from '../src/api/schemas.js';
import { buildDonePayload, paginate, sortFindings, toConciseFindings } from '../src/domain/findings.js';
import { deriveVerdict } from '../src/domain/verdict.js';

const finding = (i: number, over: Partial<FindingLite> = {}): FindingLite => ({
  id: `f${i}`,
  severity: 'SUGGESTION',
  category: 'style',
  title: `t${i}`,
  file: `src/${String(i).padStart(2, '0')}.ts`,
  start_line: i,
  end_line: i,
  rationale: 'r',
  ...over,
});

const run: RunState = {
  run_id: 'r1', agent_id: 'a', agent_name: 'Sec', status: 'done', error: null,
  findings_count: 25, score: 70, blockers: 0, ran_at: null,
};

describe('deriveVerdict', () => {
  it.each([
    [{ findings_count: 0, blockers: 0 }, 'approve'],
    [{ findings_count: null, blockers: null }, 'approve'],
    [{ findings_count: 3, blockers: 1 }, 'request_changes'],
    [{ findings_count: 3, blockers: 0 }, 'comment'],
  ] as const)('%j -> %s', (input, expected) => {
    expect(deriveVerdict(input)).toBe(expected);
  });
});

describe('findings', () => {
  it('sorts by severity, file, line and paginates with a stable cursor', () => {
    const all = Array.from({ length: 25 }, (_, i) => finding(i));
    all.push(finding(99, { severity: 'CRITICAL' }));
    const sorted = sortFindings(all.slice(0, 25).reverse().concat(all[25]!));
    expect(sorted[0]?.severity).toBe('CRITICAL');
    const p1 = paginate(sorted, {});
    expect('error' in p1).toBe(false);
    if ('error' in p1) return;
    expect(p1.page).toHaveLength(20);
    expect(p1.total).toBe(26);
    expect(p1.next_cursor).toBe('20');
    const p2 = paginate(sorted, { cursor: p1.next_cursor! });
    if ('error' in p2) throw new Error('unexpected');
    expect(p2.page).toHaveLength(6);
    expect(p2.next_cursor).toBeNull();
  });

  it('rejects a malformed or out-of-range cursor', () => {
    const items = [1, 2, 3];
    expect(paginate(items, { cursor: 'abc' })).toEqual({ error: 'invalid_cursor' });
    expect(paginate(items, { cursor: '3' })).toEqual({ error: 'invalid_cursor' });
    expect(paginate([], { cursor: '0' })).toMatchObject({ total: 0, next_cursor: null });
  });

  it('truncates long rationale to 400 and formats line ranges', () => {
    const [c] = toConciseFindings([finding(1, { rationale: 'x'.repeat(5000), start_line: 4, end_line: 9 })]);
    expect(c?.rationale).toHaveLength(400);
    expect(c?.lines).toBe('4-9');
  });

  it('builds the done payload from the run row verdict and the full counts', () => {
    const review: ReviewLite = {
      id: 'v', run_id: 'r1', summary: 's', score: 70,
      findings: Array.from({ length: 25 }, (_, i) => finding(i)),
    };
    const out = buildDonePayload({ run, review, context: { repo: 'a/b', pr_number: 1, reused: false } });
    if ('error' in out) throw new Error('unexpected');
    expect(out.verdict).toBe('comment');
    expect(out.counts).toEqual({ SUGGESTION: 25 });
    expect(out.findings).toHaveLength(20);
    expect(buildDonePayload({ run, review, cursor: 'zz', context: { reused: true } })).toEqual({ error: 'invalid_cursor' });
  });
});

import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { groundFindings } from '../src/platform/grounding.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';

// The marker sits between the `-` and the `+` line and again after the `+` line.
const MARKER_BETWEEN = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,2 @@',
  ' a',
  '-b',
  '\\ No newline at end of file',
  '+c',
  '\\ No newline at end of file',
].join('\n');

// The marker closes a hunk whose last line is an addition.
const MARKER_AT_END = [
  'diff --git a/src/x.ts b/src/x.ts',
  '--- a/src/x.ts',
  '+++ b/src/x.ts',
  '@@ -5,2 +5,3 @@',
  ' x',
  ' y',
  '+z',
  '\\ No newline at end of file',
].join('\n');

function f(partial: Partial<Finding>): Finding {
  return {
    id: 'x',
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    file: 'src/a.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'r',
    confidence: 0.8,
    ...partial,
  };
}

describe('parseUnifiedDiff — "\\ No newline at end of file"', () => {
  it('does not count the marker as a new-side line after a changed last line', () => {
    const file = parseUnifiedDiff(MARKER_AT_END).files[0]!;
    expect(file.hunks[0]!.newLineNumbers).toEqual([5, 6, 7]);
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(0);
  });

  it('skips a marker between a deletion and an addition', () => {
    const file = parseUnifiedDiff(MARKER_BETWEEN).files[0]!;
    expect(file.hunks[0]!.newLineNumbers).toEqual([1, 2]);
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(1);
  });

  it('grounds a finding on the real line and drops one on the phantom line', () => {
    const diff = parseUnifiedDiff(MARKER_BETWEEN);
    const res = groundFindings(
      [f({ start_line: 2, end_line: 2 }), f({ start_line: 4, end_line: 4 })],
      diff,
    );
    expect(res.kept.map((k) => k.start_line)).toEqual([2]);
    expect(res.dropped).toHaveLength(1);
  });
});

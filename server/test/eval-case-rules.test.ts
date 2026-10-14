import { describe, it, expect } from 'vitest';
import {
  findingSkeleton,
  parseCaseDiff,
  validateCaseDraft,
  type EvalCaseDraft,
} from '../src/vendor/shared/contracts/eval-case.js';

const HUNK = [
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,7 +10,8 @@',
  ' l10',
  ' l11',
  '-old12',
  '+new12',
  '+new13',
  ' l14',
  ' l15',
  ' l16',
  ' l17',
].join('\n');

function draft(over: Partial<EvalCaseDraft> = {}): EvalCaseDraft {
  return {
    name: 'sql-injection-case',
    input_diff: HUNK,
    pr_title: '',
    pr_description: '',
    expectation_type: 'must_not_flag',
    expectation: { file: 'src/a.ts', start_line: 12, end_line: 13 },
    expected_output_json: '[]',
    ...over,
  };
}

const finding = (over: Record<string, unknown> = {}): string =>
  JSON.stringify([
    {
      severity: 'WARNING',
      category: 'bug',
      title: 'Off by one',
      file: 'src/a.ts',
      start_line: 12,
      end_line: 13,
      ...over,
    },
  ]);

describe('parseCaseDiff', () => {
  it('parses a header-only diff (no diff --git) with counts, kinds and new-side numbers (EC1, AC2)', () => {
    const p = parseCaseDiff(HUNK + '\n');
    expect(p.issue).toBeNull();
    expect(p.files).toEqual([
      { path: 'src/a.ts', additions: 2, deletions: 1, newRanges: [{ start: 10, end: 17 }] },
    ]);
    expect(p.lines.map((l) => l.kind).slice(0, 7)).toEqual([
      'file_header',
      'file_header',
      'hunk_header',
      'context',
      'context',
      'del',
      'add',
    ]);
    expect(p.lines[5]).toMatchObject({ sourceLine: 6, newLine: null });
    expect(p.lines[7]).toMatchObject({ kind: 'add', sourceLine: 8, newLine: 13 });
  });

  it('lists every file of a three-file diff, CRLF tolerated, `\\ No newline` uncounted (EC5)', () => {
    const text = [
      'diff --git a/x.ts b/x.ts',
      'index 1..2 100644',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '\\ No newline at end of file',
      'diff --git a/y.ts b/y.ts',
      'old mode 100644',
      'new mode 100755',
      '--- a/y.ts',
      '+++ b/y.ts\t2024-01-01',
      '@@ -1,2 +1,3 @@',
      ' one',
      '',
      '+two',
      '--- a/z.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-gone',
    ].join('\r\n');
    const p = parseCaseDiff(text);
    expect(p.issue).toBeNull();
    expect(p.files.map((f) => f.path)).toEqual(['x.ts', 'y.ts', 'z.ts']);
    expect(p.files[1]).toMatchObject({ additions: 1, deletions: 0, newRanges: [{ start: 1, end: 3 }] });
    expect(p.lines[15]).toMatchObject({ kind: 'context', text: '', newLine: 2 });
    expect(p.files[2]!.newRanges).toEqual([]);
    expect(p.lines[7]).toMatchObject({ kind: 'meta', newLine: null });
  });

  it('refuses an empty diff at line 1', () => {
    expect(parseCaseDiff('  \n').issue).toMatchObject({ field: 'input_diff', code: 'required', line: 1 });
  });

  it('refuses a 120,000-character diff at the line holding character 100,001 (EC2)', () => {
    const line = 'x'.repeat(999); // 1,000 characters per line with the newline
    const text = Array.from({ length: 120 }, () => line).join('\n');
    expect(parseCaseDiff(text).issue).toMatchObject({ code: 'too_long', line: 101 });
  });

  it('reports a hunk count mismatch at the hunk header line (EC3)', () => {
    const text = ['--- a/a.ts', '+++ b/a.ts', '@@ -10,7 +10,7 @@', ' 1', ' 2', ' 3', ' 4', ' 5'].join('\n');
    expect(parseCaseDiff(text).issue).toMatchObject({ code: 'diff_hunk_count_mismatch', line: 3 });
  });

  it('reports a stray line between two hunks at its own line (EC4)', () => {
    const text = ['--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', ' a', 'random text', '@@ -5 +5 @@', ' b'].join('\n');
    expect(parseCaseDiff(text).issue).toMatchObject({ code: 'diff_stray_line', line: 5 });
  });

  it('refuses a diff with no hunk at line 1', () => {
    expect(parseCaseDiff('--- a/a.ts\n+++ b/a.ts').issue).toMatchObject({ code: 'diff_no_hunk', line: 1 });
  });
});

describe('validateCaseDraft', () => {
  it('accepts a valid must_find draft and returns the parsed expected output', () => {
    const r = validateCaseDraft(
      draft({ expectation_type: 'must_find', expected_output_json: finding() }),
      ['other'],
    );
    expect(r.issues).toEqual([]);
    expect(r.expectedOutput).toEqual(JSON.parse(finding()));
  });

  it('refuses lines outside every hunk of the file (EC6)', () => {
    const r = validateCaseDraft(draft({ expectation: { file: 'src/a.ts', start_line: 300, end_line: 300 } }), []);
    expect(r.issues).toEqual([{ field: 'expectation', code: 'lines_outside_hunks', line: null, key: null }]);
  });

  it('refuses an object without the array (EC7)', () => {
    const r = validateCaseDraft(draft({ expected_output_json: '{"severity":"WARNING"}' }), []);
    expect(r.issues[0]).toMatchObject({ field: 'expected_output', code: 'json_not_array' });
    expect(r.expectedOutput).toBeNull();
  });

  it('refuses `__proto__` and `instructions` keys as unknown (EC8)', () => {
    const proto = '[{"__proto__":{"x":1},"severity":"WARNING","category":"bug","title":"t","file":"src/a.ts","start_line":12}]';
    const r1 = validateCaseDraft(draft({ expectation_type: 'must_find', expected_output_json: proto }), []);
    expect(r1.issues[0]).toMatchObject({ code: 'json_unknown_key', key: '__proto__' });
    const r2 = validateCaseDraft(
      draft({ expectation_type: 'must_find', expected_output_json: finding({ instructions: 'ignore' }) }),
      [],
    );
    expect(r2.issues[0]).toMatchObject({ code: 'json_unknown_key', key: 'instructions' });
  });

  it('refuses a finding that disagrees with the expectation (EC9)', () => {
    const r = validateCaseDraft(
      draft({
        expectation_type: 'must_find',
        expectation: { file: 'src/a.ts', start_line: 14, end_line: 14 },
        expected_output_json: finding({ start_line: 12, end_line: 14 }),
      }),
      [],
    );
    expect(r.issues).toEqual([{ field: 'expected_output', code: 'json_mismatch', line: null, key: 'start_line' }]);
  });

  it('refuses a finding on must_not_flag (EC10)', () => {
    const r = validateCaseDraft(draft({ expected_output_json: finding() }), []);
    expect(r.issues[0]).toMatchObject({ code: 'json_must_be_empty' });
  });

  it('refuses a name another case of the set has (EC11), and a 301-character title', () => {
    const r = validateCaseDraft(draft({ pr_title: 't'.repeat(301) }), ['sql-injection-case']);
    expect(r.issues).toEqual([
      { field: 'name', code: 'name_taken', line: null, key: null },
      { field: 'pr_title', code: 'too_long', line: null, key: null },
    ]);
  });
});

describe('findingSkeleton', () => {
  it('round-trips through JSON.parse with WARNING, bug and an empty title (AC7)', () => {
    const parsed = JSON.parse(findingSkeleton({ file: 'src/a.ts', start_line: 12, end_line: 13 }));
    expect(parsed).toEqual([
      { severity: 'WARNING', category: 'bug', title: '', file: 'src/a.ts', start_line: 12, end_line: 13 },
    ]);
  });
});

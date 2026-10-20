import { z } from 'zod';
import { EvalExpectationType, EvalExpectedFinding, type EvalExpectedOutput } from './eval-ci.js';

/**
 * SPEC-06 — Case Editor rules shared by the client editor and the server.
 *
 * Pure code (zod only, no I/O): the editor runs `validateCaseDraft` while the
 * user types and the server runs the very same function on every save, so a
 * form the editor accepts never fails on save for a rule it could have shown.
 * This file is byte-identical in `server/src/vendor/shared` and
 * `client/src/vendor/shared`.
 */

export const EVAL_CASE_LIMITS = {
  diffChars: 100_000,
  prTitleChars: 300,
  prDescriptionChars: 4_000,
  expectedOutputChars: 20_000,
  findingTitleChars: 200,
  nameChars: 60,
} as const;

export const EVAL_CASE_NAME_PATTERN = /^[a-z0-9-]+$/;

/** Draft fields, in the order their issues are reported. */
export const EvalCaseIssueField = z.enum([
  'name',
  'input_diff',
  'pr_title',
  'pr_description',
  'expectation',
  'expected_output',
]);
export type EvalCaseIssueField = z.infer<typeof EvalCaseIssueField>;

export const EvalCaseIssueCode = z.enum([
  'required',
  'too_long',
  'name_charset',
  'name_taken',
  'diff_no_hunk',
  'diff_hunk_count_mismatch',
  'diff_stray_line',
  'file_not_in_diff',
  'start_below_one',
  'start_after_end',
  'lines_outside_hunks',
  'json_syntax',
  'json_not_array',
  'json_must_be_empty',
  'json_one_finding',
  'json_unknown_key',
  'json_missing_key',
  'json_bad_severity',
  'json_bad_category',
  'json_bad_title',
  'json_mismatch',
]);
export type EvalCaseIssueCode = z.infer<typeof EvalCaseIssueCode>;

/** One refusal reason; `line` for diff issues, `key` for JSON key issues. */
export const EvalCaseIssue = z.object({
  field: EvalCaseIssueField,
  code: EvalCaseIssueCode,
  line: z.number().int().positive().nullable(),
  key: z.string().nullable(),
});
export type EvalCaseIssue = z.infer<typeof EvalCaseIssue>;

/** Request body of create and update; ranges are checked by `validateCaseDraft`. */
export const EvalCaseDraft = z.object({
  name: z.string(),
  input_diff: z.string(),
  pr_title: z.string(),
  pr_description: z.string(),
  expectation_type: EvalExpectationType,
  expectation: z.object({
    file: z.string(),
    start_line: z.number().int(),
    end_line: z.number().int(),
  }),
  expected_output_json: z.string(),
});
export type EvalCaseDraft = z.infer<typeof EvalCaseDraft>;

export interface CaseDiffLine {
  kind: 'file_header' | 'hunk_header' | 'context' | 'add' | 'del' | 'meta';
  text: string;
  /** 1-based line of the pasted text. */
  sourceLine: number;
  /** New-side line number for context and added lines; null otherwise. */
  newLine: number | null;
}

export interface CaseDiffFile {
  path: string;
  additions: number;
  deletions: number;
  /** Inclusive new-side range of every hunk with new-side lines. */
  newRanges: { start: number; end: number }[];
}

export interface CaseDiffParse {
  files: CaseDiffFile[];
  lines: CaseDiffLine[];
  /** The first issue met; parsing stops there. */
  issue: EvalCaseIssue | null;
}

export interface CaseDraftCheck {
  issues: EvalCaseIssue[];
  diff: CaseDiffParse;
  /** Non-null only when the expected output has no issue. */
  expectedOutput: EvalExpectedOutput | null;
}

const FILE_HEADER_PREFIXES: readonly string[] = [
  'diff --git ',
  'index ',
  '--- ',
  '+++ ',
  'new file mode',
  'deleted file mode',
  'old mode',
  'new mode',
  'similarity index',
  'dissimilarity index',
  'rename from',
  'rename to',
  'copy from',
  'copy to',
  'Binary files ',
];

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const FINDING_KEYS: readonly string[] = ['severity', 'category', 'title', 'file', 'start_line', 'end_line'];
const REQUIRED_FINDING_KEYS: readonly string[] = ['severity', 'category', 'title', 'file', 'start_line'];

function issue(
  field: EvalCaseIssueField,
  code: EvalCaseIssueCode,
  line: number | null = null,
  key: string | null = null,
): EvalCaseIssue {
  return { field, code, line, key };
}

function isFileHeader(line: string): boolean {
  return FILE_HEADER_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/** Path of a `--- ` / `+++ ` header: the `a/` or `b/` prefix and a tab suffix stripped. */
function headerPath(line: string, prefix: 'a/' | 'b/'): string {
  let path = line.slice(4);
  const tab = path.indexOf('\t');
  if (tab >= 0) path = path.slice(0, tab);
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Strict unified-diff parser for a hand-written case (SPEC-06 A2). Stops at the
 * first issue: a non-header line outside a hunk is `diff_stray_line` at that
 * line; a hunk whose body disagrees with its header counts is
 * `diff_hunk_count_mismatch` at the hunk header's line.
 */
export function parseCaseDiff(text: string): CaseDiffParse {
  const files: CaseDiffFile[] = [];
  const lines: CaseDiffLine[] = [];
  const fail = (code: EvalCaseIssueCode, line: number): CaseDiffParse => ({
    files,
    lines,
    issue: issue('input_diff', code, line),
  });

  if (text.trim() === '') return fail('required', 1);
  if (text.length > EVAL_CASE_LIMITS.diffChars) {
    const before = text.slice(0, EVAL_CASE_LIMITS.diffChars);
    return fail('too_long', before.split('\n').length);
  }

  const source = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  while (source.length > 0 && source[source.length - 1] === '') source.pop();

  let oldPath: string | null = null;
  let current: CaseDiffFile | null = null;
  let hunkLine = 0; // source line of the current (or last) hunk header; 0 = none yet
  let oldLeft = 0;
  let newLeft = 0;
  let newCursor = 0;
  let hunks = 0;

  for (let i = 0; i < source.length; i++) {
    const raw = source[i]!;
    const sourceLine = i + 1;
    const inHunk = oldLeft > 0 || newLeft > 0;

    if (inHunk) {
      const first = raw.charAt(0);
      if (first === '\\') {
        lines.push({ kind: 'meta', text: raw, sourceLine, newLine: null });
      } else if (first === ' ' || raw === '') {
        if (oldLeft === 0 || newLeft === 0) return fail('diff_hunk_count_mismatch', hunkLine);
        oldLeft--;
        newLeft--;
        lines.push({ kind: 'context', text: raw, sourceLine, newLine: newCursor++ });
      } else if (first === '+') {
        if (newLeft === 0) return fail('diff_hunk_count_mismatch', hunkLine);
        newLeft--;
        current!.additions++;
        lines.push({ kind: 'add', text: raw, sourceLine, newLine: newCursor++ });
      } else if (first === '-') {
        if (oldLeft === 0) return fail('diff_hunk_count_mismatch', hunkLine);
        oldLeft--;
        current!.deletions++;
        lines.push({ kind: 'del', text: raw, sourceLine, newLine: null });
      } else {
        return fail('diff_hunk_count_mismatch', hunkLine);
      }
      continue;
    }

    if (isFileHeader(raw)) {
      if (raw.startsWith('diff --git ')) {
        oldPath = null;
        current = null;
        hunkLine = 0;
      } else if (raw.startsWith('--- ')) {
        oldPath = headerPath(raw, 'a/');
        current = null;
        hunkLine = 0;
      } else if (raw.startsWith('+++ ')) {
        const newPath = headerPath(raw, 'b/');
        const path = newPath === '/dev/null' && oldPath !== null ? oldPath : newPath;
        current = { path, additions: 0, deletions: 0, newRanges: [] };
        files.push(current);
        hunkLine = 0;
      }
      lines.push({ kind: 'file_header', text: raw, sourceLine, newLine: null });
      continue;
    }

    if (raw.startsWith('@@')) {
      const match = HUNK_HEADER.exec(raw);
      if (!match || current === null) return fail('diff_stray_line', sourceLine);
      const oldCount = match[2] === undefined ? 1 : Number(match[2]);
      const newStart = Number(match[3]);
      const newCount = match[4] === undefined ? 1 : Number(match[4]);
      if (newCount > 0) current.newRanges.push({ start: newStart, end: newStart + newCount - 1 });
      hunkLine = sourceLine;
      oldLeft = oldCount;
      newLeft = newCount;
      newCursor = newStart;
      hunks++;
      lines.push({ kind: 'hunk_header', text: raw, sourceLine, newLine: null });
      continue;
    }

    // Right after a finished hunk: a `\ No newline…` marker is allowed, a
    // further body line means the header counts were too small.
    if (hunkLine > 0) {
      const first = raw.charAt(0);
      if (first === '\\') {
        lines.push({ kind: 'meta', text: raw, sourceLine, newLine: null });
        continue;
      }
      if (first === ' ' || first === '+' || first === '-') {
        return fail('diff_hunk_count_mismatch', hunkLine);
      }
    }
    return fail('diff_stray_line', sourceLine);
  }

  if (oldLeft > 0 || newLeft > 0) return fail('diff_hunk_count_mismatch', hunkLine);
  if (hunks === 0) return fail('diff_no_hunk', 1);
  return { files, lines, issue: null };
}

function checkName(name: string, otherNames: readonly string[]): EvalCaseIssue | null {
  if (name.length === 0) return issue('name', 'required');
  if (name.length > EVAL_CASE_LIMITS.nameChars) return issue('name', 'too_long');
  if (!EVAL_CASE_NAME_PATTERN.test(name)) return issue('name', 'name_charset');
  if (otherNames.includes(name)) return issue('name', 'name_taken');
  return null;
}

function checkExpectation(draft: EvalCaseDraft, diff: CaseDiffParse): EvalCaseIssue | null {
  const { file, start_line, end_line } = draft.expectation;
  const parsed = diff.files.find((f) => f.path === file);
  if (parsed === undefined) return issue('expectation', 'file_not_in_diff');
  if (start_line < 1) return issue('expectation', 'start_below_one');
  if (start_line > end_line) return issue('expectation', 'start_after_end');
  const hits = parsed.newRanges.some((r) => start_line <= r.end && end_line >= r.start);
  if (!hits) return issue('expectation', 'lines_outside_hunks');
  return null;
}

/** Maps the first zod issue of one finding to a closed issue code. */
function findingIssue(error: z.ZodError): EvalCaseIssue {
  const first = error.issues[0];
  const key = first !== undefined && typeof first.path[0] === 'string' ? first.path[0] : null;
  if (key === 'severity') return issue('expected_output', 'json_bad_severity');
  if (key === 'category') return issue('expected_output', 'json_bad_category');
  if (key === 'title') return issue('expected_output', 'json_bad_title');
  if (key !== null) return issue('expected_output', 'json_mismatch', null, key);
  return issue('expected_output', 'json_one_finding');
}

function checkExpectedOutput(
  draft: EvalCaseDraft,
): { issue: EvalCaseIssue; output: null } | { issue: null; output: EvalExpectedOutput } {
  const fail = (found: EvalCaseIssue): { issue: EvalCaseIssue; output: null } => ({ issue: found, output: null });
  const json = draft.expected_output_json;
  if (json.length > EVAL_CASE_LIMITS.expectedOutputChars) return fail(issue('expected_output', 'too_long'));

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fail(issue('expected_output', 'json_syntax'));
  }
  if (!Array.isArray(parsed)) return fail(issue('expected_output', 'json_not_array'));

  if (draft.expectation_type === 'must_not_flag') {
    return parsed.length === 0 ? { issue: null, output: [] } : fail(issue('expected_output', 'json_must_be_empty'));
  }
  if (parsed.length !== 1) return fail(issue('expected_output', 'json_one_finding'));

  const item: unknown = parsed[0];
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return fail(issue('expected_output', 'json_one_finding'));
  }
  // Own keys of the parsed object, so a `__proto__` key from JSON.parse is seen.
  const keys = Object.keys(item);
  const unknownKey = keys.find((k) => !FINDING_KEYS.includes(k));
  if (unknownKey !== undefined) return fail(issue('expected_output', 'json_unknown_key', null, unknownKey));
  const missingKey = REQUIRED_FINDING_KEYS.find((k) => !keys.includes(k));
  if (missingKey !== undefined) return fail(issue('expected_output', 'json_missing_key', null, missingKey));

  const result = EvalExpectedFinding.safeParse(item);
  if (!result.success) return fail(findingIssue(result.error));
  const finding = result.data;
  const { expectation } = draft;
  if (finding.file !== expectation.file) return fail(issue('expected_output', 'json_mismatch', null, 'file'));
  if (finding.start_line !== expectation.start_line) {
    return fail(issue('expected_output', 'json_mismatch', null, 'start_line'));
  }
  if (finding.end_line !== undefined && finding.end_line !== expectation.end_line) {
    return fail(issue('expected_output', 'json_mismatch', null, 'end_line'));
  }
  return { issue: null, output: [finding] };
}

/**
 * Every editor rule (SPEC-06 AC3–AC8) over one draft: at most one issue per
 * field, in `EvalCaseIssueField` order. `otherNames` are the names of the
 * other cases of the owner's set — the caller excludes the case's own name.
 */
export function validateCaseDraft(draft: EvalCaseDraft, otherNames: readonly string[]): CaseDraftCheck {
  const diff = parseCaseDiff(draft.input_diff);
  const output = checkExpectedOutput(draft);
  const found: (EvalCaseIssue | null)[] = [
    checkName(draft.name, otherNames),
    diff.issue,
    draft.pr_title.length > EVAL_CASE_LIMITS.prTitleChars ? issue('pr_title', 'too_long') : null,
    draft.pr_description.length > EVAL_CASE_LIMITS.prDescriptionChars ? issue('pr_description', 'too_long') : null,
    diff.issue === null ? checkExpectation(draft, diff) : null,
    output.issue,
  ];
  return {
    issues: found.filter((i): i is EvalCaseIssue => i !== null),
    diff,
    expectedOutput: output.output,
  };
}

/** Pretty JSON of one expected finding at the expectation's place (SPEC-06 AC7). */
export function findingSkeleton(expectation: EvalCaseDraft['expectation']): string {
  const skeleton = [
    {
      severity: 'WARNING',
      category: 'bug',
      title: '',
      file: expectation.file,
      start_line: expectation.start_line,
      end_line: expectation.end_line,
    },
  ];
  return JSON.stringify(skeleton, null, 2);
}

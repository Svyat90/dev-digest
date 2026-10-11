import { describe, it, expect } from 'vitest';
import type { BlastRadiusResponse } from '@devdigest/shared';
import { InvalidStructuredOutputError } from '@devdigest/reviewer-core';
import {
  ConfigError,
  ExternalServiceError,
  InvalidModelOutputError,
  NotFoundError,
} from '../src/platform/errors.js';
import { TimeoutError } from '../src/platform/resilience.js';
import {
  blastFacts,
  capChars,
  classifyGenerationError,
  classifySourceError,
  computeMissingInputs,
  finalizeAnswer,
  fitBriefInput,
  hunkRanges,
  isBlastAvailable,
} from '../src/modules/brief/helpers.js';
import { MAX_CALLER_FILES } from '../src/modules/brief/constants.js';
import type { BriefAnswerRaw, BriefInput } from '../src/modules/brief/types.js';

function blast(over: Partial<BlastRadiusResponse> = {}): BlastRadiusResponse {
  return {
    changed_symbols: [],
    downstream: [],
    summary: '',
    degraded: false,
    reason: null,
    index_status: 'full',
    index_sha: null,
    limits: { max_callers_per_symbol: 10 },
    ...over,
  };
}

describe('hunkRanges', () => {
  it('reads new-side ranges from hunk headers only; a pure deletion and null give none', () => {
    expect(hunkRanges('@@ -1,2 +10,15 @@\n+x\n@@ -40 +60 @@\n+y')).toEqual([
      { start: 10, end: 24 },
      { start: 60, end: 60 },
    ]);
    expect(hunkRanges('@@ -5,3 +5,0 @@\n-a')).toEqual([]);
    expect(hunkRanges(null)).toEqual([]);
  });
});

describe('capChars', () => {
  it('cuts without splitting a surrogate pair and reports whether it cut', () => {
    expect(capChars('abc', 5)).toEqual({ text: 'abc', cut: false });
    expect(capChars('ab😀cd', 3)).toEqual({ text: 'ab', cut: true });
  });
});

describe('isBlastAvailable / blastFacts', () => {
  it('degraded without data is unavailable; degraded with data is available', () => {
    expect(isBlastAvailable(blast({ degraded: true, reason: 'no_data' }))).toBe(false);
    const withData = blast({
      degraded: true,
      reason: 'index_partial',
      changed_symbols: [{ name: 'f', file: 'a.ts', kind: 'function' }],
    });
    expect(isBlastAvailable(withData)).toBe(true);
  });

  it('caps the caller list at MAX_CALLER_FILES but the allow-list stays uncapped', () => {
    const callers = Array.from({ length: MAX_CALLER_FILES + 5 }, (_, i) => ({
      name: 'c',
      file: `c${String(i).padStart(3, '0')}.ts`,
      line: 1,
    }));
    const { fact, allowFiles } = blastFacts(
      blast({
        summary: 's',
        changed_symbols: [{ name: 'f', file: 'a.ts', kind: 'function' }],
        downstream: [{ symbol: 'f', callers, endpoints_affected: [], crons_affected: [] }],
      }),
    );
    expect(fact.callerFiles).toHaveLength(MAX_CALLER_FILES);
    expect(allowFiles.size).toBe(MAX_CALLER_FILES + 5 + 1);
    expect(allowFiles.has('a.ts')).toBe(true);
  });
});

describe('computeMissingInputs', () => {
  const base = { intent: null, blast: null, issuesReferenced: 0, issuesFetched: 0, documents: 1 };
  it('lists every missing fact; a stale intent is intent_stale; no closing ref is no linked_issue', () => {
    expect(
      computeMissingInputs({ ...base, issuesReferenced: 1, documents: 0 }),
    ).toEqual(['intent', 'blast', 'linked_issue', 'documents']);
    expect(
      computeMissingInputs({
        ...base,
        intent: { intent: 'x', inScope: [], outOfScope: [], stale: true },
        blast: { summary: 's', callerFiles: [] },
      }),
    ).toEqual(['intent_stale']);
  });
});

describe('fitBriefInput', () => {
  const chars = (i: BriefInput): number =>
    i.title.length +
    i.description.length +
    i.issues.reduce((n, x) => n + x.text.length, 0) +
    i.documents.reduce((n, x) => n + x.text.length, 0) +
    i.files.reduce((n, x) => n + x.path.length, 0) +
    (i.blast?.callerFiles.join('').length ?? 0) +
    (i.intent?.intent.length ?? 0) +
    (i.blast?.summary.length ?? 0);

  const make = (): BriefInput => ({
    title: 'T',
    description: 'd'.repeat(2000),
    issues: [{ ref: '#1', text: 'i'.repeat(2000) }],
    intent: { intent: 'keep me', inScope: [], outOfScope: [], stale: false },
    blast: { summary: 'sum', callerFiles: ['x.ts', 'y.ts'] },
    files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((path) => ({
      path,
      role: 'core' as const,
      additions: 1,
      deletions: 0,
      ranges: [],
    })),
    omittedFiles: 0,
    documents: [{ path: 'd.md', text: 'x'.repeat(3000) }],
    missing: ['documents'],
  });

  it('meets a moderate budget with the AC5 steps alone, never below the floor, no forced drop', () => {
    const input = make();
    const before = JSON.stringify(input);
    const r = fitBriefInput(input, chars, 6000);
    expect(r.fits).toBe(true);
    expect(r.forceDropped).toBe(false);
    expect(chars(r.input)).toBeLessThanOrEqual(6000);
    expect(r.truncated).toEqual(['documents']);
    expect(r.input.documents[0]!.text.length).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('a tiny budget runs the forced steps; intent, blast summary and missing stay', () => {
    const r = fitBriefInput(make(), chars, 20);
    expect(r.fits).toBe(true);
    expect(r.forceDropped).toBe(true);
    expect(chars(r.input)).toBeLessThanOrEqual(20);
    expect(r.input.documents).toEqual([]);
    expect(r.input.issues).toEqual([]);
    expect(r.input.description).toBe('');
    expect(r.input.files).toEqual([]);
    expect(r.input.omittedFiles).toBe(4);
    expect(r.input.intent?.intent).toBe('keep me');
    expect(r.input.blast?.summary).toBe('sum');
    expect(r.input.missing).toEqual(['documents']);
    expect(new Set(r.truncated).size).toBe(r.truncated.length);
    expect(r.truncated).toEqual(
      expect.arrayContaining(['documents', 'linked_issues', 'description', 'files']),
    );
  });

  it('cuts the blast caller list from its tail as the last forced step', () => {
    const r = fitBriefInput(make(), chars, 15);
    expect(r.fits).toBe(true);
    expect(r.input.blast?.callerFiles).toEqual(['x.ts']);
    expect(r.truncated).toContain('blast_callers');
  });

  it('a budget below the never-shortened parts reports fits: false', () => {
    expect(fitBriefInput(make(), chars, 3).fits).toBe(false);
  });
});

describe('finalizeAnswer', () => {
  const ref = (file: string, start_line: number, end_line: number | null = null) => ({
    file,
    start_line,
    end_line,
  });
  const risk = (
    severity: 'high' | 'medium' | 'low',
    file_refs: ReturnType<typeof ref>[],
    title = 't',
  ) => ({ kind: 'k', title, explanation: 'e', severity, file_refs });
  const diff = new Set(['src/a.ts']);
  const blastFiles = new Set(['src/caller.ts']);

  it('normalises paths, drops invalid refs, empty risks and invalid focus; keeps blast-only files', () => {
    const answer: BriefAnswerRaw = {
      summary: 's',
      risks: [
        risk('low', [ref('./src/a.ts ', 3)]),
        risk('high', [ref('src/made-up.ts', 1), ref('src/a.ts', 0), ref('src/a.ts', 1.5)]),
        risk('high', [ref('src/a.ts', 5, 2), ref('src/caller.ts', 4, 6)]),
      ],
      review_focus: [
        { file: 'src/a.ts', line: 2, reason: 'r' },
        { file: 'src/typo.ts', line: 2, reason: 'r' },
        { file: 'src/a.ts', line: 0, reason: 'r' },
      ],
    };
    const r = finalizeAnswer(answer, diff, blastFiles);
    expect(r.risks.map((x) => x.severity)).toEqual(['high', 'low']);
    expect(r.risks[0]!.file_refs).toEqual([ref('src/caller.ts', 4, 6)]);
    expect(r.risks[1]!.file_refs).toEqual([ref('src/a.ts', 3)]);
    expect(r.review_focus).toEqual([{ file: 'src/a.ts', line: 2, reason: 'r' }]);
    expect(r.dropped).toEqual({ risks: 1, riskRefs: 4, focus: 2 });
  });

  it('applies the limits by cutting; everything dropped keeps the summary', () => {
    const many: BriefAnswerRaw = {
      summary: 's'.repeat(900),
      risks: Array.from({ length: 9 }, () => risk('medium', [ref('src/a.ts', 1)], 'T'.repeat(300))),
      review_focus: Array.from({ length: 9 }, () => ({
        file: 'src/a.ts',
        line: 1,
        reason: 'r'.repeat(300),
      })),
    };
    const r = finalizeAnswer(many, diff, blastFiles);
    expect(r.summary).toHaveLength(600);
    expect(r.risks).toHaveLength(6);
    expect(r.risks[0]!.title).toHaveLength(120);
    expect(r.review_focus).toHaveLength(8);
    expect(r.review_focus[0]!.reason).toHaveLength(200);

    const none = finalizeAnswer(
      { summary: 'kept', risks: [risk('high', [ref('nope.ts', 1)])], review_focus: [] },
      diff,
      blastFiles,
    );
    expect(none).toMatchObject({ summary: 'kept', risks: [], review_focus: [] });
  });
});

describe('classifyGenerationError', () => {
  it('decides by class, never by message', () => {
    expect(classifyGenerationError(new InvalidModelOutputError('x'))).toBe('invalid_answer');
    expect(classifyGenerationError(new InvalidStructuredOutputError('x'))).toBe('invalid_answer');
    expect(classifyGenerationError(new ConfigError('x'))).toBe('not_configured');
    expect(classifyGenerationError(new ExternalServiceError('x'))).toBe('provider_unavailable');
    expect(classifyGenerationError(new TimeoutError(5))).toBe('provider_unavailable');
    expect(classifyGenerationError(new Error('failed schema validation'))).toBe(
      'provider_unavailable',
    );
  });
});

describe('classifySourceError', () => {
  it('maps absent, unavailable and unexpected', () => {
    expect(classifySourceError({ status: 404 }).kind).toBe('absent');
    expect(classifySourceError(new NotFoundError()).kind).toBe('absent');
    expect(classifySourceError({ status: 403 })).toEqual({ kind: 'unavailable', reason: 'http_403' });
    expect(classifySourceError({ status: 502 }).kind).toBe('unavailable');
    expect(classifySourceError(new TimeoutError(5))).toEqual({ kind: 'unavailable', reason: 'timeout' });
    expect(classifySourceError(new ConfigError('GITHUB_TOKEN missing'))).toEqual({
      kind: 'unavailable',
      reason: 'config',
    });
    expect(classifySourceError({ code: 'ECONNRESET' }).kind).toBe('unavailable');
    expect(classifySourceError(new TypeError('x'))).toEqual({ kind: 'unexpected', reason: 'TypeError' });
  });
});

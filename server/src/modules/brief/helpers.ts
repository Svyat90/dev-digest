import type {
  BlastRadiusResponse,
  BriefMissingInput,
  BriefTruncatableSource,
  Risk,
  RiskSeverity,
  ReviewFocusItem,
} from '@devdigest/shared';
import { InvalidStructuredOutputError } from '@devdigest/reviewer-core';
import {
  ConfigError,
  ExternalServiceError,
  InvalidModelOutputError,
  NotFoundError,
} from '../../platform/errors.js';
import { TimeoutError } from '../../platform/resilience.js';
import {
  MAX_CALLER_FILES,
  MAX_FOCUS_ITEMS,
  MAX_FOCUS_REASON_CHARS,
  MAX_RISKS,
  MAX_RISK_EXPLANATION_CHARS,
  MAX_RISK_TITLE_CHARS,
  MAX_SUMMARY_CHARS,
  MIN_TRIMMED_SOURCE_CHARS,
} from './constants.js';
import type {
  BriefAnswerRaw,
  BriefBlastFact,
  BriefDropCounts,
  BriefGenerationFailure,
  BriefInput,
  BriefIntentFact,
  BriefSourceErrorKind,
  LineRange,
} from './types.js';

/**
 * Brief module — pure rules. Hunk ranges, missing inputs, hard budget fitting,
 * answer validation and cut, error classification. No I/O, no clock, no env;
 * row shapes come from `./types.js`, never from the repository.
 */

// ---------------------------------------------------------------- Text

/** Cut to `max` chars without splitting a surrogate pair. */
export function capChars(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const end = /[\uD800-\uDBFF]/.test(text[max - 1] ?? '') ? max - 1 : max;
  return { text: text.slice(0, end), cut: true };
}

// ---------------------------------------------------------------- Diff

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;

/** New-side line ranges from hunk headers only; a pure deletion yields none. */
export function hunkRanges(patch: string | null): LineRange[] {
  if (!patch) return [];
  const out: LineRange[] = [];
  for (const m of patch.matchAll(HUNK_RE)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count > 0) out.push({ start, end: start + count - 1 });
  }
  return out;
}

// ---------------------------------------------------------------- Blast

export function isBlastAvailable(blast: BlastRadiusResponse): boolean {
  const hasData = blast.changed_symbols.length > 0 || blast.downstream.length > 0;
  return !blast.degraded || hasData;
}

/** The model-facing fact (capped caller list) and the AC12 allow-list (uncapped). */
export function blastFacts(blast: BlastRadiusResponse): {
  fact: BriefBlastFact;
  allowFiles: Set<string>;
} {
  const callers = new Set<string>();
  for (const d of blast.downstream) for (const c of d.callers) callers.add(c.file);
  const allowFiles = new Set<string>(callers);
  for (const s of blast.changed_symbols) allowFiles.add(s.file);
  const callerFiles = [...callers].sort().slice(0, MAX_CALLER_FILES);
  return { fact: { summary: blast.summary, callerFiles }, allowFiles };
}

// ---------------------------------------------------------------- Missing inputs

export function computeMissingInputs(f: {
  intent: BriefIntentFact | null;
  blast: BriefBlastFact | null;
  issuesReferenced: number;
  issuesFetched: number;
  documents: number;
}): BriefMissingInput[] {
  const out: BriefMissingInput[] = [];
  if (!f.intent) out.push('intent');
  else if (f.intent.stale) out.push('intent_stale');
  if (!f.blast) out.push('blast');
  if (f.issuesReferenced > 0 && f.issuesFetched < f.issuesReferenced) out.push('linked_issue');
  if (f.documents === 0) out.push('documents');
  return out;
}

// ---------------------------------------------------------------- Budget

/**
 * Hard cap (A4). AC5 priority steps first, then the forced-drop steps, with a
 * re-measure after every step. Never shortens `intent`, `blast.summary` or
 * `missing`; never mutates `input`.
 */
export function fitBriefInput(
  input: BriefInput,
  measure: (input: BriefInput) => number,
  budget: number,
): {
  input: BriefInput;
  truncated: BriefTruncatableSource[];
  forceDropped: boolean;
  fits: boolean;
} {
  const cur: BriefInput = {
    ...input,
    issues: input.issues.map((i) => ({ ...i })),
    documents: input.documents.map((d) => ({ ...d })),
    files: [...input.files],
    blast: input.blast ? { ...input.blast, callerFiles: [...input.blast.callerFiles] } : null,
  };
  const truncated: BriefTruncatableSource[] = [];
  let forceDropped = false;
  const mark = (s: BriefTruncatableSource): void => {
    if (!truncated.includes(s)) truncated.push(s);
  };
  const over = (): boolean => measure(cur) > budget;

  /** Shorten the longest item by 25 % per step, never below the floor. */
  const shrinkLongest = <T extends { text: string }>(items: T[], source: BriefTruncatableSource): void => {
    while (over()) {
      let pick: T | undefined;
      for (const it of items) {
        if (it.text.length > MIN_TRIMMED_SOURCE_CHARS && (!pick || it.text.length > pick.text.length)) {
          pick = it;
        }
      }
      if (!pick) return;
      const next = Math.max(MIN_TRIMMED_SOURCE_CHARS, Math.floor(pick.text.length * 0.75));
      pick.text = capChars(pick.text, next).text;
      mark(source);
    }
  };

  // AC5 priority steps.
  shrinkLongest(cur.documents, 'documents');
  shrinkLongest(cur.issues, 'linked_issues');
  if (over() && cur.description.length > MIN_TRIMMED_SOURCE_CHARS) {
    const holder = { text: cur.description };
    shrinkLongest([holder], 'description');
    cur.description = holder.text;
  }
  while (over() && cur.files.length > 1) {
    cur.files.pop();
    cur.omittedFiles += 1;
    mark('files');
  }

  // Forced-drop steps (A4 order).
  const force = (source: BriefTruncatableSource): void => {
    forceDropped = true;
    mark(source);
  };
  while (over() && cur.documents.length > 0) {
    let longest = 0;
    cur.documents.forEach((d, i) => {
      if (d.text.length > cur.documents[longest]!.text.length) longest = i;
    });
    cur.documents.splice(longest, 1);
    force('documents');
  }
  if (over() && cur.issues.length > 0) {
    cur.issues = [];
    force('linked_issues');
  }
  if (over() && cur.description.length > 0) {
    cur.description = '';
    force('description');
  }
  if (over() && cur.files.length > 0) {
    cur.omittedFiles += cur.files.length;
    cur.files = [];
    force('files');
  }
  while (over() && cur.blast && cur.blast.callerFiles.length > 0) {
    cur.blast.callerFiles.pop();
    force('blast_callers');
  }

  return { input: cur, truncated, forceDropped, fits: !over() };
}

// ---------------------------------------------------------------- Answer

function normalizePath(p: string): string {
  let s = p.trim();
  while (s.startsWith('./')) s = s.slice(2);
  return s;
}

const isLine = (n: number): boolean => Number.isInteger(n) && n > 0;

const SEVERITY_RANK: Record<RiskSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Allow-list validation (AC12) and the output caps (AC27, applied by cutting). */
export function finalizeAnswer(
  answer: BriefAnswerRaw,
  diffFiles: ReadonlySet<string>,
  blastFiles: ReadonlySet<string>,
): { summary: string; risks: Risk[]; review_focus: ReviewFocusItem[]; dropped: BriefDropCounts } {
  const allowed = (file: string): boolean => diffFiles.has(file) || blastFiles.has(file);
  const dropped: BriefDropCounts = { risks: 0, riskRefs: 0, focus: 0 };

  const risks: Risk[] = [];
  for (const r of answer.risks) {
    const refs: Risk['file_refs'] = [];
    for (const ref of r.file_refs) {
      const file = normalizePath(ref.file);
      const endOk = ref.end_line === null || (isLine(ref.end_line) && ref.end_line >= ref.start_line);
      if (allowed(file) && isLine(ref.start_line) && endOk) {
        refs.push({ file, start_line: ref.start_line, end_line: ref.end_line });
      } else {
        dropped.riskRefs += 1;
      }
    }
    if (refs.length === 0) {
      dropped.risks += 1;
      continue;
    }
    risks.push({
      kind: r.kind,
      title: capChars(r.title.trim(), MAX_RISK_TITLE_CHARS).text,
      explanation: capChars(r.explanation.trim(), MAX_RISK_EXPLANATION_CHARS).text,
      severity: r.severity,
      file_refs: refs,
    });
  }
  // Array.prototype.sort is stable: model order is kept within one severity.
  risks.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  dropped.risks += Math.max(0, risks.length - MAX_RISKS);

  const focus: ReviewFocusItem[] = [];
  for (const f of answer.review_focus) {
    const file = normalizePath(f.file);
    if (allowed(file) && isLine(f.line)) {
      focus.push({ file, line: f.line, reason: capChars(f.reason.trim(), MAX_FOCUS_REASON_CHARS).text });
    } else {
      dropped.focus += 1;
    }
  }
  dropped.focus += Math.max(0, focus.length - MAX_FOCUS_ITEMS);

  return {
    summary: capChars(answer.summary.trim(), MAX_SUMMARY_CHARS).text,
    risks: risks.slice(0, MAX_RISKS),
    review_focus: focus.slice(0, MAX_FOCUS_ITEMS),
    dropped,
  };
}

// ---------------------------------------------------------------- Errors

/** By class only, never by message (A8). InvalidModelOutputError is an ExternalServiceError: checked first. */
export function classifyGenerationError(err: unknown): BriefGenerationFailure {
  if (err instanceof InvalidModelOutputError || err instanceof InvalidStructuredOutputError) {
    return 'invalid_answer';
  }
  if (err instanceof ConfigError) return 'not_configured';
  return 'provider_unavailable';
}

const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED']);

function httpStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const o = err as { status?: unknown; statusCode?: unknown };
  if (typeof o.status === 'number') return o.status;
  if (typeof o.statusCode === 'number') return o.statusCode;
  return null;
}

/** Fact-source failure -> matrix outcome. `reason` is a short content-free code. */
export function classifySourceError(err: unknown): { kind: BriefSourceErrorKind; reason: string } {
  const status = httpStatus(err);
  if (err instanceof NotFoundError || status === 404) return { kind: 'absent', reason: 'not_found' };
  if (err instanceof TimeoutError) return { kind: 'unavailable', reason: 'timeout' };
  if (err instanceof ConfigError) return { kind: 'unavailable', reason: 'config' };
  if (err instanceof ExternalServiceError) return { kind: 'unavailable', reason: 'external_service' };
  if (status !== null && (status === 401 || status === 403 || status === 429 || status >= 500)) {
    return { kind: 'unavailable', reason: `http_${status}` };
  }
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && NETWORK_CODES.has(code)) {
    return { kind: 'unavailable', reason: code.toLowerCase() };
  }
  return { kind: 'unexpected', reason: err instanceof Error ? err.name : 'unknown' };
}

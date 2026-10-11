import type {
  BriefMissingInput,
  RiskSeverity,
  SmartDiffRole,
} from '@devdigest/shared';

/**
 * Plain shapes shared by the brief module's files. No zod and no imports
 * outside `@devdigest/shared`, so every brief file can import this without a cycle.
 */

/** Inclusive new-side line range of one diff hunk. */
export interface LineRange {
  start: number;
  end: number;
}

export interface BriefFileFact {
  path: string;
  role: SmartDiffRole;
  additions: number;
  deletions: number;
  ranges: LineRange[];
}

export interface BriefIssueFact {
  ref: string;
  text: string;
}

export interface BriefIntentFact {
  intent: string;
  inScope: string[];
  outOfScope: string[];
  stale: boolean;
}

export interface BriefBlastFact {
  summary: string;
  callerFiles: string[];
}

export interface BriefDocumentFact {
  path: string;
  text: string;
}

export interface BriefInput {
  title: string;
  description: string;
  issues: BriefIssueFact[];
  intent: BriefIntentFact | null;
  blast: BriefBlastFact | null;
  files: BriefFileFact[];
  omittedFiles: number;
  documents: BriefDocumentFact[];
  missing: BriefMissingInput[];
}

/** The model's structured answer before allow-list validation and the caps. */
export interface BriefAnswerRaw {
  summary: string;
  risks: {
    kind: string;
    title: string;
    explanation: string;
    severity: RiskSeverity;
    file_refs: { file: string; start_line: number; end_line: number | null }[];
  }[];
  review_focus: { file: string; line: number; reason: string }[];
}

export interface BriefDropCounts {
  risks: number;
  riskRefs: number;
  focus: number;
}

export type BriefGenerationFailure = 'invalid_answer' | 'provider_unavailable' | 'not_configured';

export type BriefFactSource = 'intent' | 'blast' | 'smart_diff' | 'documents' | 'issue';

export type BriefSourceErrorKind = 'absent' | 'unavailable' | 'unexpected';

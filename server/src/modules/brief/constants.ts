/** Brief module limits. Pure values: no env, no I/O. */

/** Hard cap on the model input, in tokens counted by the server tokenizer (A4). */
export const BRIEF_INPUT_TOKEN_BUDGET = 8000;
export const MAX_DESCRIPTION_CHARS = 4000;
export const MAX_LINKED_ISSUES = 3;
export const MAX_BODY_SCAN_CHARS = 20_000;
export const MAX_ISSUE_CHARS = 12_000;
export const MAX_DOCUMENTS = 20;
/** A source shortened by the AC5 steps is never cut below this. */
export const MIN_TRIMMED_SOURCE_CHARS = 500;
export const MAX_CALLER_FILES = 100;

export const MAX_SUMMARY_CHARS = 600;
export const MAX_RISKS = 6;
export const MAX_RISK_TITLE_CHARS = 120;
export const MAX_RISK_EXPLANATION_CHARS = 600;
export const MAX_FOCUS_ITEMS = 8;
export const MAX_FOCUS_REASON_CHARS = 200;

export const BRIEF_MODEL_TIMEOUT_MS = 60_000;
/** One deadline for all linked-issue fetches together. */
export const ISSUE_FETCH_DEADLINE_MS = 5000;

/** Evals module limits. Pure values: no env, no I/O. */

/** A stored patch above this many characters is refused (AC7, EC24). */
export const MAX_FROZEN_DIFF_CHARS = 100_000;
export const MAX_PR_DESCRIPTION_CHARS = 4_000;
export const MAX_CASE_NAME_CHARS = 60;
/** Total insert attempts when a concurrent insert takes the chosen name (A17). */
export const MAX_CASE_NAME_ATTEMPTS = 5;

export const EVAL_CASE_CONCURRENCY = 3;
/** Per-case bound around the engine call (A7). */
export const EVAL_CASE_TIMEOUT_MS = 180_000;
export const MAX_ERROR_REASON_CHARS = 200;

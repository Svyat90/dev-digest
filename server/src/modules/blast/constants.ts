/** PH2 — how many changed files (largest by additions + deletions) we read git history for. */
export const HISTORY_MAX_FILES = 10;
/** PH2 — newest commits taken per file from the local clone. */
export const HISTORY_COMMITS_PER_FILE = 5;
/** PH3 — upper bound on GitHub `listPullsForCommit` lookups per request. */
export const HISTORY_MAX_COMMIT_LOOKUPS = 20;
/** PH4 — upper bound on prior PRs returned. */
export const HISTORY_MAX_ITEMS = 10;
/** PH3 — concurrent GitHub lookups. */
export const HISTORY_LOOKUP_CONCURRENCY = 4;

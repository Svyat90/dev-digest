// --- Read-time limits -------------------------------------------------------
/**
 * [T1] Caller fan-out cap per changed symbol (ORDER BY rank DESC LIMIT N).
 * Lives in `domain/` because both `repo-intel` (the cap) and `blast` (echoes it
 * to the client) need it and modules may not import each other.
 */
export const MAX_CALLERS_PER_SYMBOL = 20;

/** The eval run-start limit shared by every run-start route (SPEC-05 NFR Concurrency and rate). */
export const RUN_START_LIMIT = { max: 10, windowMs: 60_000 } as const;

export interface RunStartLimitResult {
  allowed: boolean;
  /** Milliseconds until the window resets; 0 when the start is allowed. */
  retryAfterMs: number;
}

/**
 * In-memory fixed-window counter of eval run starts, keyed by workspace. State
 * resets on restart; it assumes one API instance per database.
 */
export class RunStartLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(opts: { max?: number; windowMs?: number; now?: () => number } = {}) {
    this.max = opts.max ?? RUN_START_LIMIT.max;
    this.windowMs = opts.windowMs ?? RUN_START_LIMIT.windowMs;
    this.now = opts.now ?? Date.now;
  }

  /** Counts one start for the workspace, or refuses it without counting. */
  tryStart(workspaceId: string): RunStartLimitResult {
    const now = this.now();
    let w = this.windows.get(workspaceId);
    if (!w || now - w.start >= this.windowMs) {
      w = { start: now, count: 0 };
      this.windows.set(workspaceId, w);
    }
    if (w.count >= this.max) {
      return { allowed: false, retryAfterMs: w.start + this.windowMs - now };
    }
    w.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }
}

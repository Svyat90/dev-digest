import type { RunState } from '../api/schemas.js';

/** Structurally compatible with tools/common.ts Clock; declared here so domain stays free of tools/. */
export interface WaitClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export type WaitOutcome =
  | { kind: 'done' | 'failed' | 'cancelled'; run: RunState }
  | { kind: 'timeout'; run: RunState }
  | { kind: 'aborted' };

function isAbort(err: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (err instanceof Error && err.name === 'AbortError');
}

/**
 * Polls a run until it leaves `running`. `deadlineMs` is the maximum wait measured from
 * the call. A timeout is a typed outcome carrying the last run; callers must switch on
 * `kind`. Errors other than aborts (e.g. ApiError) propagate.
 */
export async function waitForRun(args: {
  getRun: (signal?: AbortSignal) => Promise<RunState>;
  clock: WaitClock;
  pollIntervalMs: number;
  deadlineMs: number;
  signal?: AbortSignal;
  onTick?: (elapsedMs: number) => void;
}): Promise<WaitOutcome> {
  const { getRun, clock, pollIntervalMs, deadlineMs, signal, onTick } = args;
  const start = clock.now();
  for (;;) {
    if (signal?.aborted) return { kind: 'aborted' };
    let run: RunState;
    try {
      run = await getRun(signal);
    } catch (err) {
      if (isAbort(err, signal)) return { kind: 'aborted' };
      throw err;
    }
    const elapsed = clock.now() - start;
    onTick?.(elapsed);
    switch (run.status) {
      case 'done':
        return { kind: 'done', run };
      case 'failed':
        return { kind: 'failed', run };
      case 'cancelled':
        return { kind: 'cancelled', run };
      default:
        break; // running, or an unknown/null status: keep waiting
    }
    const remaining = deadlineMs - elapsed;
    if (remaining <= 0) return { kind: 'timeout', run };
    try {
      await clock.sleep(Math.min(pollIntervalMs, remaining), signal);
    } catch (err) {
      if (isAbort(err, signal)) return { kind: 'aborted' };
      throw err;
    }
  }
}

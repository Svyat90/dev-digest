import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunState } from '../src/api/schemas.js';
import { isStaleRun, waitForRun, type WaitClock } from '../src/domain/wait.js';

const state = (status: string): RunState => ({
  run_id: 'r1', agent_id: 'a', agent_name: 'A', status, error: null,
  findings_count: null, score: null, blockers: null, ran_at: null,
});

const clock: WaitClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
    }),
};

describe('waitForRun', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns done after two sleeps', async () => {
    const seq = ['running', 'running', 'done'];
    const getRun = vi.fn(async () => state(seq.shift()!));
    const onTick = vi.fn();
    const p = waitForRun({ getRun, clock, pollIntervalMs: 5000, deadlineMs: 600000, onTick });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await p).toMatchObject({ kind: 'done' });
    expect(getRun).toHaveBeenCalledTimes(3);
    expect(onTick).toHaveBeenCalledTimes(3);
  });

  it('returns timeout carrying the last run at the deadline, never done', async () => {
    const getRun = vi.fn(async () => state('running'));
    const p = waitForRun({ getRun, clock, pollIntervalMs: 5000, deadlineMs: 12000 });
    await vi.advanceTimersByTimeAsync(20000);
    const out = await p;
    expect(out.kind).toBe('timeout');
    if (out.kind === 'timeout') expect(out.run.status).toBe('running');
  });

  it('aborts mid-sleep with no further getRun call', async () => {
    const getRun = vi.fn(async () => state('running'));
    const ac = new AbortController();
    const p = waitForRun({ getRun, clock, pollIntervalMs: 5000, deadlineMs: 600000, signal: ac.signal });
    await vi.advanceTimersByTimeAsync(1000);
    ac.abort();
    expect(await p).toEqual({ kind: 'aborted' });
    await vi.advanceTimersByTimeAsync(20000);
    expect(getRun).toHaveBeenCalledTimes(1);
  });
});

describe('isStaleRun', () => {
  const start = '2026-01-01T00:00:00.000Z';
  const at = (ms: number): number => Date.parse(start) + ms;

  it('is stale only strictly past the bound', () => {
    expect(isStaleRun(start, at(1000), 1000)).toBe(false);
    expect(isStaleRun(start, at(1001), 1000)).toBe(true);
    expect(isStaleRun(start, at(10), 1000)).toBe(false);
  });

  it('never calls a run with an unknown start stale', () => {
    expect(isStaleRun(null, at(1e9), 1000)).toBe(false);
    expect(isStaleRun('not a date', at(1e9), 1000)).toBe(false);
  });
});

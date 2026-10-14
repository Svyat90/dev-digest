import { describe, it, expect } from 'vitest';
import { RunStartLimiter, RUN_START_LIMIT } from '../src/platform/run-start-limiter.js';

function makeClock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('RunStartLimiter', () => {
  it('allows 10 starts per workspace per window and refuses the 11th without counting it', () => {
    const clock = makeClock();
    const limiter = new RunStartLimiter({ ...RUN_START_LIMIT, now: clock.now });
    for (let i = 0; i < 10; i++) expect(limiter.tryStart('w1').allowed).toBe(true);

    clock.advance(10_000);
    const refused = limiter.tryStart('w1');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBe(50_000);

    // a refusal neither extends the window nor the count
    expect(limiter.tryStart('w1').retryAfterMs).toBe(50_000);
    expect(limiter.tryStart('w2').allowed).toBe(true);

    clock.advance(RUN_START_LIMIT.windowMs);
    expect(limiter.tryStart('w1').allowed).toBe(true);
  });

  it('never refuses with an infinite max', () => {
    const limiter = new RunStartLimiter({ max: Number.POSITIVE_INFINITY });
    for (let i = 0; i < 100; i++) expect(limiter.tryStart('w1').allowed).toBe(true);
  });
});

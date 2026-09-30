import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/platform/config.js';

// LLM_DEADLINE_MS feeds AbortSignal.timeout, which fires after 1 ms for any delay
// above 2^31-1 — so an oversized value must fail at boot, not on every review.
describe('LLM_DEADLINE_MS (loadConfig, explicit env — process.env untouched)', () => {
  const cfg = (env: Record<string, string>) => loadConfig(env as NodeJS.ProcessEnv);

  it('passes a valid value through and leaves an empty one to the engine default', () => {
    expect(cfg({ LLM_DEADLINE_MS: '600000' }).llmDeadlineMs).toBe(600000);
    expect(cfg({ LLM_DEADLINE_MS: '' }).llmDeadlineMs).toBeUndefined();
  });

  it('rejects a value above the largest timer delay', () => {
    expect(() => cfg({ LLM_DEADLINE_MS: '2147483647' })).not.toThrow();
    expect(() => cfg({ LLM_DEADLINE_MS: '3000000000' })).toThrow();
  });
});

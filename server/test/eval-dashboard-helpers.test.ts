import { describe, it, expect } from 'vitest';
import { toRunSummary } from '../src/modules/eval-dashboard/helpers.js';
import type { SuiteRunRowLike } from '../src/modules/eval-dashboard/helpers.js';

const row: SuiteRunRowLike = {
  id: 'r1',
  agentId: 'a1',
  status: 'completed',
  startedAt: new Date('2026-10-12T10:00:00.000Z'),
  finishedAt: new Date('2026-10-12T10:01:00.000Z'),
  durationMs: 60000,
  agentVersion: 2,
  casesTotal: 3,
  casesDone: 3,
  casesScored: 3,
  casesPassed: 2,
  recall: 0.5,
  precision: null,
  citationAccuracy: 1,
  costUsd: null,
  error: null,
};

describe('toRunSummary', () => {
  it('maps dates to ISO strings and snake_case keys', () => {
    const s = toRunSummary(row);
    expect(s.started_at).toBe('2026-10-12T10:00:00.000Z');
    expect(s.finished_at).toBe('2026-10-12T10:01:00.000Z');
    expect(s.agent_id).toBe('a1');
    expect(s.cases_passed).toBe(2);
    expect(toRunSummary({ ...row, finishedAt: null }).finished_at).toBeNull();
  });

  it('keeps unknown cost null and free cost 0', () => {
    expect(toRunSummary(row).cost_usd).toBeNull();
    expect(toRunSummary({ ...row, costUsd: 0 }).cost_usd).toBe(0);
  });
});

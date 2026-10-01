import { describe, it, expect } from 'vitest';
import { BlastRadiusResponse } from '@devdigest/shared';
import { toBlastRadius } from '../src/modules/blast/helpers.js';
import type { BlastFacadeResult } from '../src/modules/blast/types.js';

const limits = { maxCallersPerSymbol: 7 };
const full = { status: 'full' as const, lastIndexedSha: 'idx1' };

const healthy: BlastFacadeResult = {
  changedSymbols: [
    { file: 'src/a.ts', name: 'alpha', kind: 'function' },
    { file: 'src/a.ts', name: 'beta', kind: 'function' },
  ],
  callers: [
    { file: 'src/low.ts', symbol: 'lowFn', viaSymbol: 'alpha', line: 4, rank: 1 },
    { file: 'src/api.ts', symbol: 'handler', viaSymbol: 'beta', line: 9, rank: 5 },
    { file: 'src/job.ts', symbol: 'tick', viaSymbol: 'beta', line: 2, rank: 3 },
  ],
  impactedEndpoints: ['GET /x'],
  factsByFile: {
    'src/api.ts': { endpoints: ['GET /x'], crons: [] },
    'src/job.ts': { endpoints: [], crons: ['0 * * * *'] },
    'src/low.ts': { endpoints: [], crons: [] },
  },
};

describe('toBlastRadius', () => {
  it('groups by symbol, attributes facts per group, orders by rank and summarises', () => {
    const out = toBlastRadius(healthy, full, limits);
    expect(() => BlastRadiusResponse.parse(out)).not.toThrow();
    expect(out.downstream.map((g) => g.symbol)).toEqual(['beta', 'alpha']); // BR5
    const beta = out.downstream[0]!;
    expect(beta.endpoints_affected).toEqual(['GET /x']); // BR4
    expect(beta.crons_affected).toEqual(['0 * * * *']);
    expect(beta.callers.map((c) => c.file)).toEqual(['src/api.ts', 'src/job.ts']);
    expect(out.downstream[1]!.endpoints_affected).toEqual([]);
    expect(out.summary).toBe('2 symbols · 3 callers · 1 endpoint · 1 cron'); // BR7
    expect(out.limits.max_callers_per_symbol).toBe(7);
    expect(out.degraded).toBe(false);
    expect(out.reason).toBeNull();
  });

  it('drops callers in the declaring file and omits an emptied group (BR3)', () => {
    const out = toBlastRadius(
      {
        ...healthy,
        callers: [
          { file: 'src/a.ts', symbol: 'self', viaSymbol: 'alpha', line: 1, rank: 9 },
          { file: 'src/api.ts', symbol: 'handler', viaSymbol: 'beta', line: 9, rank: 5 },
        ],
      },
      full,
      limits,
    );
    expect(out.downstream.map((g) => g.symbol)).toEqual(['beta']);
  });

  it('returns empty endpoint/cron lists without factsByFile (BR4)', () => {
    const { factsByFile: _omit, ...noFacts } = healthy;
    const out = toBlastRadius(noFacts, full, limits);
    for (const g of out.downstream) {
      expect(g.endpoints_affected).toEqual([]);
      expect(g.crons_affected).toEqual([]);
    }
  });

  it('degrades honestly (BR8) and nulls an empty index sha (BR13)', () => {
    const passthrough = toBlastRadius({ ...healthy, degraded: true, reason: 'no_data' }, full, limits);
    expect([passthrough.degraded, passthrough.reason]).toEqual([true, 'no_data']);

    const partial = toBlastRadius(healthy, { status: 'partial', lastIndexedSha: '' }, limits);
    expect([partial.degraded, partial.reason]).toEqual([true, 'index_partial']);
    expect(partial.downstream).toHaveLength(2); // data kept
    expect(partial.index_sha).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/domain/repo-intel/limits.js';

/**
 * Facade fix — the caller cap is applied PER changed symbol, not globally, and
 * the per-file facts are computed over the kept callers' files only. No DB:
 * the service's `repo` is patched, like repo-intel-facade-degraded.test.ts.
 */

const HOT_CALLERS = MAX_CALLERS_PER_SYMBOL + 5;

function buildService(factsAskedFor: string[][]): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: true },
    db: {} as never,
    codeIndex: {} as never,
  } as never;
  const svc = new RepoIntelService(container);
  const hot = Array.from({ length: HOT_CALLERS }, (_, i) => ({
    fromPath: `src/hot${i + 1}.ts`,
    toSymbol: 'hot',
    line: 1,
    rank: i + 1,
  }));
  const cold = [1, 2].map((i) => ({
    fromPath: `src/cold${i}.ts`,
    toSymbol: 'cold',
    line: 1,
    rank: 0,
  }));
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: async () => ({ status: 'full' }),
    getSymbolRows: async (_repoId: string, paths: string[]) =>
      paths.includes('src/a.ts')
        ? [
            { path: 'src/a.ts', name: 'hot', kind: 'function', line: 1 },
            { path: 'src/a.ts', name: 'cold', kind: 'function', line: 9 },
          ]
        : [],
    getResolvedCallers: async () => [...hot, ...cold],
    getFileFacts: async (_repoId: string, files: string[]) => {
      factsAskedFor.push(files);
      return files.map((filePath) => ({ filePath, endpoints: [], crons: [] }));
    },
  };
  return svc;
}

describe('RepoIntel facade — per-symbol caller cap', () => {
  it('caps each changed symbol on its own and computes facts over kept callers only', async () => {
    const asked: string[][] = [];
    const svc = buildService(asked);
    const blast = await svc.getBlastRadius('r1', ['src/a.ts']);

    const hot = blast.callers.filter((c) => c.viaSymbol === 'hot');
    const cold = blast.callers.filter((c) => c.viaSymbol === 'cold');
    expect(hot).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    // highest ranks kept, in DESC order
    expect(hot.map((c) => c.rank)).toEqual(
      Array.from({ length: MAX_CALLERS_PER_SYMBOL }, (_, i) => HOT_CALLERS - i),
    );
    // the cold symbol is not starved by the hot one
    expect(cold).toHaveLength(2);

    expect(asked).toHaveLength(1);
    expect([...asked[0]!].sort()).toEqual([...new Set(blast.callers.map((c) => c.file))].sort());
    expect(asked[0]).not.toContain('src/hot1.ts');
  });
});

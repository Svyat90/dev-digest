import { describe, it, expect, vi } from 'vitest';
import { BlastRadiusResponse } from '@devdigest/shared';
import { NotFoundError } from '../src/platform/errors.js';
import { BlastService, type BlastDeps } from '../src/modules/blast/service.js';
import type { BlastFacadeResult } from '../src/modules/blast/types.js';

const healthy: BlastFacadeResult = {
  changedSymbols: [{ file: 'src/a.ts', name: 'alpha', kind: 'function' }],
  callers: [{ file: 'src/api.ts', symbol: 'handler', viaSymbol: 'alpha', line: 3, rank: 2 }],
  impactedEndpoints: ['GET /x'],
  factsByFile: { 'src/api.ts': { endpoints: ['GET /x'], crons: [] } },
};

function build(over: Partial<BlastDeps> = {}, result: BlastFacadeResult = healthy) {
  const getBlastRadius = vi.fn(async () => result);
  const getIndexState = vi.fn(async () => ({ status: 'full' as const, lastIndexedSha: 'idx1' }));
  const info = vi.fn();
  const deps: BlastDeps = {
    repo: {
      getPull: async (_ws, id) => (id === 'p1' ? { id: 'p1', repoId: 'r1', number: 7 } : undefined),
      listChangedFiles: async () => [
        { path: 'src/a.ts', additions: 5, deletions: 1 },
        { path: 'src/b.ts', additions: 1, deletions: 0 },
      ],
      getRepo: async () => ({ owner: 'acme', name: 'a', clonePath: '/clone' }),
    },
    repoIntel: { getBlastRadius, getIndexState },
    git: {
      log: async (_r, path) => [
        { sha: `sha-${path}`, message: '', author: '', date: '2026-01-01T00:00:00Z' },
      ],
    },
    github: async () => ({
      listPullsForCommit: async (_r, sha) => [
        { number: sha === 'sha-src/a.ts' ? 5 : 6, title: 't', author: 'dev', mergedAt: '2026-01-02T00:00:00Z' },
      ],
    }),
    logger: { info },
    ...over,
  };
  return { svc: new BlastService(deps), getBlastRadius, getIndexState, info };
}

describe('BlastService.get', () => {
  it('reads the facade and the index state once each and logs the source', async () => {
    const { svc, getBlastRadius, getIndexState, info } = build();
    const out = await svc.get('ws', 'p1');
    expect(() => BlastRadiusResponse.parse(out)).not.toThrow();
    expect(getBlastRadius).toHaveBeenCalledTimes(1);
    expect(getBlastRadius).toHaveBeenCalledWith('r1', ['src/a.ts', 'src/b.ts']);
    expect(getIndexState).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ source: 'index', prId: 'p1' }), 'blast radius read');
  });

  it('404s an unknown PR before touching the facade, and tags a fallback read', async () => {
    const { svc, getBlastRadius } = build();
    await expect(svc.get('ws', 'nope')).rejects.toBeInstanceOf(NotFoundError);
    expect(getBlastRadius).not.toHaveBeenCalled();

    const { factsByFile: _omit, ...noFacts } = healthy;
    const fb = build({}, noFacts);
    await fb.svc.get('ws', 'p1');
    expect(fb.info).toHaveBeenCalledWith(expect.objectContaining({ source: 'fallback' }), 'blast radius read');
  });
});

describe('BlastService.history', () => {
  it('returns merged prior PRs when everything is reachable', async () => {
    const out = await build().svc.history('ws', 'p1');
    expect(out.degraded).toBe(false);
    expect(out.history.map((h) => h.pr_number).sort()).toEqual([5, 6]);
  });

  it('degrades: no clone, no GitHub, partial lookups', async () => {
    const noClone = build({ repo: { ...build().svc['deps'].repo, getRepo: async () => ({ owner: 'a', name: 'b', clonePath: null }) } });
    expect(await noClone.svc.history('ws', 'p1')).toMatchObject({ degraded: true, reason: 'no_clone' });

    const noGh = build({
      github: async () => {
        throw new Error('no token');
      },
    });
    expect(await noGh.svc.history('ws', 'p1')).toMatchObject({ degraded: true, reason: 'github_unavailable' });

    const partial = build({
      github: async () => ({
        listPullsForCommit: async (_r, sha) => {
          if (sha === 'sha-src/b.ts') throw new Error('rate limited');
          return [{ number: 5, title: 't', author: 'dev', mergedAt: '2026-01-02T00:00:00Z' }];
        },
      }),
    });
    const out = await partial.svc.history('ws', 'p1');
    expect(out).toMatchObject({ degraded: true, reason: 'partial' });
    expect(out.history.map((h) => h.pr_number)).toEqual([5]);
  });
});

import type { BlastRadiusResponse, GitClient, GitCommit, GitHubClient, PrHistoryResponse } from '@devdigest/shared';
import { MAX_CALLERS_PER_SYMBOL } from '../../domain/repo-intel/limits.js';
import { NotFoundError } from '../../platform/errors.js';
import { HISTORY_LOOKUP_CONCURRENCY } from './constants.js';
import { toBlastRadius } from './helpers.js';
import { collectCommitShas, mergePrHistory, pickHistoryFiles } from './history-helpers.js';
import type { BlastRepository } from './repository.js';
import type { BlastIndexReader } from './types.js';

/**
 * Narrow deps: only what this service calls, never the whole `Container`
 * (onion-architecture §5 Application). `BlastRepository` is a type-only import.
 */
export interface BlastDeps {
  repo: Pick<BlastRepository, 'getPull' | 'listChangedFiles' | 'getRepo'>;
  repoIntel: BlastIndexReader;
  git: Pick<GitClient, 'log'>;
  github: () => Promise<Pick<GitHubClient, 'listPullsForCommit'>>;
  logger: { info(obj: unknown, msg?: string): void };
}

type Settled<T> = { ok: true; value: T } | { ok: false };

/** Runs `fn` over `items` with at most `limit` in flight; never rejects, records each outcome. */
async function mapBounded<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<Settled<R>[]> {
  const out: Settled<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { ok: true, value: await fn(items[i] as T) };
      } catch {
        out[i] = { ok: false };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export class BlastService {
  constructor(private deps: BlastDeps) {}

  /**
   * Reads the precomputed index once (facade + index state) and maps it to the
   * contract. No model call, no re-parse. The facade does not throw (BR9).
   */
  async get(workspaceId: string, prId: string): Promise<BlastRadiusResponse> {
    const startedAt = Date.now();
    const pull = await this.deps.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const paths = (await this.deps.repo.listChangedFiles(prId)).map((f) => f.path);
    const [result, state] = await Promise.all([
      this.deps.repoIntel.getBlastRadius(pull.repoId, paths),
      this.deps.repoIntel.getIndexState(pull.repoId),
    ]);
    const out = toBlastRadius(result, state, { maxCallersPerSymbol: MAX_CALLERS_PER_SYMBOL });

    this.deps.logger.info(
      {
        prId,
        repoId: pull.repoId,
        source: result.factsByFile ? 'index' : 'fallback',
        indexStatus: state.status,
        symbols: out.changed_symbols.length,
        callers: out.downstream.reduce((n, g) => n + g.callers.length, 0),
        durationMs: Date.now() - startedAt,
      },
      'blast radius read',
    );
    return out;
  }

  /** Prior merged PRs that touched the same files: local git history → GitHub lookups. No model call. */
  async history(workspaceId: string, prId: string): Promise<PrHistoryResponse> {
    const pull = await this.deps.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const repo = await this.deps.repo.getRepo(workspaceId, pull.repoId);
    if (!repo || repo.clonePath == null) return { history: [], degraded: true, reason: 'no_clone' };

    const files = pickHistoryFiles(await this.deps.repo.listChangedFiles(prId));
    const ref = { owner: repo.owner, name: repo.name };
    const logs: { path: string; commits: GitCommit[] }[] = [];
    // A single file whose log throws is skipped; all of them throwing means the clone is gone.
    for (const path of files) {
      try {
        logs.push({ path, commits: await this.deps.git.log(ref, path) });
      } catch {
        /* skipped */
      }
    }
    if (files.length > 0 && logs.length === 0) return { history: [], degraded: true, reason: 'no_clone' };

    const { shas, filesBySha } = collectCommitShas(logs);
    if (shas.length === 0) return { history: [], degraded: false, reason: null };

    let github: Pick<GitHubClient, 'listPullsForCommit'>;
    try {
      github = await this.deps.github();
    } catch {
      return { history: [], degraded: true, reason: 'github_unavailable' };
    }

    const settled = await mapBounded(shas, HISTORY_LOOKUP_CONCURRENCY, async (sha) => ({
      sha,
      pulls: await github.listPullsForCommit(ref, sha),
    }));
    const okLookups = settled.flatMap((s) => (s.ok ? [s.value] : []));
    if (okLookups.length === 0) return { history: [], degraded: true, reason: 'github_unavailable' };

    return {
      history: mergePrHistory(okLookups, filesBySha, pull.number),
      degraded: okLookups.length < settled.length,
      reason: okLookups.length < settled.length ? 'partial' : null,
    };
  }
}

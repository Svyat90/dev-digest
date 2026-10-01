import { describe, it, expect } from 'vitest';
import type { CommitPull, GitCommit } from '@devdigest/shared';
import {
  HISTORY_COMMITS_PER_FILE,
  HISTORY_MAX_COMMIT_LOOKUPS,
  HISTORY_MAX_FILES,
} from '../src/modules/blast/constants.js';
import {
  collectCommitShas,
  mergePrHistory,
  pickHistoryFiles,
} from '../src/modules/blast/history-helpers.js';

const commit = (sha: string, date: string): GitCommit => ({ sha, message: '', author: '', date });
const pull = (number: number, mergedAt: string | null): CommitPull => ({
  number,
  title: `PR ${number}`,
  author: 'dev',
  mergedAt,
});

describe('blast history helpers', () => {
  it('merges lookups: merged only, own PR dropped, deduped with unioned overlap, newest first', () => {
    const { shas, filesBySha } = collectCommitShas([
      { path: 'a.ts', commits: [commit('s1', '2026-01-03'), commit('s2', '2026-01-02')] },
      { path: 'b.ts', commits: [commit('s2', '2026-01-02'), commit('s3', '2026-01-01')] },
    ]);
    expect(shas).toEqual(['s1', 's2', 's3']);

    const out = mergePrHistory(
      [
        { sha: 's1', pulls: [pull(7, null), pull(99, '2026-01-09T00:00:00Z')] }, // unmerged + current
        { sha: 's2', pulls: [pull(5, '2026-01-02T00:00:00Z')] },
        { sha: 's3', pulls: [pull(5, '2026-01-02T00:00:00Z'), pull(4, '2026-01-01T00:00:00Z')] },
      ],
      filesBySha,
      99,
    );
    expect(out.map((i) => i.pr_number)).toEqual([5, 4]);
    expect(out[0]).toMatchObject({
      files_overlap: ['a.ts', 'b.ts'],
      notes: 'touched 2 of these files',
    });
  });

  it('caps files, commits per file and total lookups', () => {
    const files = Array.from({ length: HISTORY_MAX_FILES + 3 }, (_, i) => ({
      path: `f${String(i).padStart(2, '0')}.ts`,
      additions: i,
      deletions: 0,
    }));
    const picked = pickHistoryFiles(files);
    expect(picked).toHaveLength(HISTORY_MAX_FILES);
    expect(picked[0]).toBe(files[files.length - 1]!.path); // largest first

    const perFile = collectCommitShas([
      {
        path: 'a.ts',
        commits: Array.from({ length: HISTORY_COMMITS_PER_FILE + 4 }, (_, i) => commit(`a${i}`, '2026-01-01')),
      },
    ]);
    expect(perFile.shas).toHaveLength(HISTORY_COMMITS_PER_FILE);

    const many = collectCommitShas(
      Array.from({ length: HISTORY_MAX_FILES }, (_, f) => ({
        path: `f${f}.ts`,
        commits: Array.from({ length: HISTORY_COMMITS_PER_FILE }, (_, i) => commit(`s${f}-${i}`, '2026-01-01')),
      })),
    );
    expect(many.shas).toHaveLength(Math.min(HISTORY_MAX_COMMIT_LOOKUPS, HISTORY_MAX_FILES * HISTORY_COMMITS_PER_FILE));
  });
});

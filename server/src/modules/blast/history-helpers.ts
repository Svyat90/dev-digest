import type { CommitPull, GitCommit, PrHistoryItem } from '@devdigest/shared';
import {
  HISTORY_COMMITS_PER_FILE,
  HISTORY_MAX_COMMIT_LOOKUPS,
  HISTORY_MAX_FILES,
  HISTORY_MAX_ITEMS,
} from './constants.js';

export interface ChangedFileSize {
  path: string;
  additions: number;
  deletions: number;
}

/** PH2 — the largest changed files by `additions + deletions`, ties by path. */
export function pickHistoryFiles(files: ChangedFileSize[]): string[] {
  return [...files]
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions) || a.path.localeCompare(b.path))
    .slice(0, HISTORY_MAX_FILES)
    .map((f) => f.path);
}

/**
 * PH2/PH3 — newest commits per file, de-duplicated, newest first, capped.
 * `filesBySha` remembers which changed files each sha touched.
 */
export function collectCommitShas(logs: { path: string; commits: GitCommit[] }[]): {
  shas: string[];
  filesBySha: Map<string, Set<string>>;
} {
  const filesBySha = new Map<string, Set<string>>();
  const dateBySha = new Map<string, string>();
  const order: string[] = []; // first-seen, for stable ties
  for (const { path, commits } of logs) {
    for (const c of commits.slice(0, HISTORY_COMMITS_PER_FILE)) {
      const files = filesBySha.get(c.sha);
      if (files) files.add(path);
      else {
        filesBySha.set(c.sha, new Set([path]));
        dateBySha.set(c.sha, c.date);
        order.push(c.sha);
      }
    }
  }
  const time = (sha: string) => Date.parse(dateBySha.get(sha) ?? '') || 0;
  const shas = order
    .map((sha, i) => ({ sha, i }))
    .sort((a, b) => time(b.sha) - time(a.sha) || a.i - b.i)
    .slice(0, HISTORY_MAX_COMMIT_LOOKUPS)
    .map((x) => x.sha);
  return { shas, filesBySha };
}

/** PH4 — merged PRs only, own PR dropped, de-duplicated, newest first, capped. */
export function mergePrHistory(
  lookups: { sha: string; pulls: CommitPull[] }[],
  filesBySha: Map<string, Set<string>>,
  currentPrNumber: number,
): PrHistoryItem[] {
  const byNumber = new Map<number, { pull: CommitPull; mergedAt: string; files: Set<string> }>();
  for (const { sha, pulls } of lookups) {
    for (const pull of pulls) {
      if (pull.mergedAt == null || pull.number === currentPrNumber) continue;
      const entry = byNumber.get(pull.number) ?? {
        pull,
        mergedAt: pull.mergedAt,
        files: new Set<string>(),
      };
      for (const f of filesBySha.get(sha) ?? []) entry.files.add(f);
      byNumber.set(pull.number, entry);
    }
  }
  return [...byNumber.values()]
    .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt) || b.pull.number - a.pull.number)
    .slice(0, HISTORY_MAX_ITEMS)
    .map(({ pull, mergedAt, files }) => ({
      pr_number: pull.number,
      title: pull.title,
      merged_at: mergedAt,
      author: pull.author,
      files_overlap: [...files].sort(),
      notes: `touched ${files.size} of these files`,
    }));
}

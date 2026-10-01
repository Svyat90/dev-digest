import type { BlastRadiusResponse, DownstreamImpact } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";

export interface BlastCounts {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}

/**
 * The summary row's four numbers. Coupled with the server's `buildSummary`
 * (BR7): symbols = changed symbols, callers = sum of group sizes, endpoints and
 * crons = unique values across groups.
 */
export function blastCounts(res: BlastRadiusResponse): BlastCounts {
  return {
    symbols: res.changed_symbols.length,
    callers: res.downstream.reduce((n, g) => n + g.callers.length, 0),
    endpoints: new Set(res.downstream.flatMap((g) => g.endpoints_affected)).size,
    crons: new Set(res.downstream.flatMap((g) => g.crons_affected)).size,
  };
}

/**
 * GitHub link for a caller line, pinned to the commit the index was built at
 * (BR13) so the line number is accurate; the PR head is only a fallback.
 */
export function callerHref(
  repoFullName: string | null,
  indexSha: string | null,
  headSha: string | null | undefined,
  caller: { file: string; line: number },
): string | null {
  const sha = indexSha ?? headSha;
  if (!repoFullName || !sha) return null;
  return githubBlobUrl(repoFullName, sha, caller.file, caller.line);
}

/** True when the server's per-symbol cap may have hidden callers of this group. */
export function isAtLimit(group: DownstreamImpact, limits: BlastRadiusResponse["limits"]): boolean {
  return group.callers.length >= limits.max_callers_per_symbol;
}

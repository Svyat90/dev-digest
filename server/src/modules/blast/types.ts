import type { BlastDegradedReason, BlastIndexStatus } from '@devdigest/shared';

/**
 * Local structural port over `container.repoIntel`. `modules/blast/**` may not
 * import `modules/repo-intel/**` (not even types: `tsPreCompilationDeps`), so the
 * facade shapes blast reads are declared here. `routes.ts` assigns
 * `container.repoIntel` to `BlastIndexReader`, which is where drift becomes a
 * compile error.
 */
export interface BlastFacadeResult {
  changedSymbols: { file: string; name: string; kind: string }[];
  callers: { file: string; symbol: string; viaSymbol: string; line: number; rank: number }[];
  impactedEndpoints: string[];
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  degraded?: boolean;
  reason?: BlastDegradedReason;
}

export interface IndexStateLike {
  status: BlastIndexStatus;
  lastIndexedSha: string;
}

/** Structural port satisfied by container.repoIntel (checked at routes.ts). */
export interface BlastIndexReader {
  getBlastRadius(repoId: string, changedFiles: string[]): Promise<BlastFacadeResult>;
  getIndexState(repoId: string): Promise<IndexStateLike>;
}

export interface BlastLimits {
  maxCallersPerSymbol: number;
}

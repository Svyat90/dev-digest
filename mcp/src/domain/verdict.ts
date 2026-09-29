export type Verdict = 'approve' | 'request_changes' | 'comment';

/**
 * Deterministic verdict from the run row, never the model's self-reported one.
 * Same rule as the GitHub review event in reviewer-core/src/output/to-review.ts:154-156.
 * Null counts on a finished run are treated as 0.
 */
export function deriveVerdict(run: { findings_count: number | null; blockers: number | null }): Verdict {
  if ((run.findings_count ?? 0) === 0) return 'approve';
  if ((run.blockers ?? 0) > 0) return 'request_changes';
  return 'comment';
}

/**
 * The ids of each agent's LATEST review, per PR — the population the FINDINGS
 * column counts.
 *
 * `rows` MUST be newest-first: the first review seen for a (PR, agent) pair
 * wins. The unit is the agent's latest REVIEW, not its latest run — a run that
 * failed wrote no review, so the agent's last real result still stands.
 * `agentId === null` (seeded / pre-`run_id` reviews) is one bucket per PR: those
 * cannot be told apart, so the newest of them wins.
 */
export function pickLatestReviewIds(
  rows: { id: string; prId: string; agentId: string | null }[],
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    const key = `${row.prId}:${row.agentId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(row.id);
  }
  return ids;
}

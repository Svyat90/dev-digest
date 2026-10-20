/**
 * Run owner guard: an `eval_suite_runs` row is an agent's own run only when
 * `agent_id` is set; skill runs (SPEC-06) leave it null and never reach agent
 * views. Pure (`domain-is-pure`).
 */

/** Narrows a run row to an agent run, so readers need no `!` assertion. */
export function isAgentRunRow<T extends { agentId: string | null }>(
  row: T,
): row is T & { agentId: string } {
  return row.agentId !== null;
}

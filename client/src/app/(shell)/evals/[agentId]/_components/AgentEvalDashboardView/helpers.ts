/* Pure rules for the agent Eval Dashboard: URL range parsing, why Run eval is
   blocked and which two selected runs form a comparison. */
import type { AgentEvalRunSummary, EvalDashboardRange } from "@devdigest/shared";

export const RANGES: readonly EvalDashboardRange[] = ["7d", "30d", "90d", "all"];

const DEFAULT_RANGE: EvalDashboardRange = "30d";

/** An unrecognised value reads as the default, never as "show nothing" (AC9). */
export function parseRange(value: string | null | undefined): EvalDashboardRange {
  return RANGES.find((r) => r === value) ?? DEFAULT_RANGE;
}

/** Days a range covers; `null` for "all". */
export function rangeDays(range: EvalDashboardRange): number | null {
  return range === "all" ? null : Number.parseInt(range, 10);
}

export function runEvalBlocker(
  casesTotal: number,
  runningRun: AgentEvalRunSummary | null,
): "noCases" | "inProgress" | null {
  if (runningRun) return "inProgress";
  return casesTotal === 0 ? "noCases" : null;
}

/** The two selected ids that are still completed runs in `runs`, else null. */
export function selectedPair(
  selected: readonly string[],
  runs: readonly AgentEvalRunSummary[],
): readonly [string, string] | null {
  if (selected.length !== 2) return null;
  const completed = new Set(runs.filter((r) => r.status === "completed").map((r) => r.id));
  const [a, b] = selected;
  if (a === undefined || b === undefined) return null;
  return completed.has(a) && completed.has(b) ? [a, b] : null;
}

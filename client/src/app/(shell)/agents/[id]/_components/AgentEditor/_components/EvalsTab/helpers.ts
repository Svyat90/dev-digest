import type { AgentEvalCaseListItem, AgentEvalRunSummary } from "@devdigest/shared";
import { NO_DATA } from "@/lib/format";

export type RunAllBlocker = "noCases" | "inProgress";

/** A 0..1 ratio as a whole percent; `null` (no data) stays `null`. */
export function toPercent(v: number | null | undefined): number | null {
  return v == null ? null : Math.round(v * 100);
}

export function formatPercent(v: number | null | undefined): string {
  const p = toPercent(v);
  return p == null ? NO_DATA : `${p}%`;
}

/** Points of change between two ratios; `null` when either side has no value (A13). */
export function deltaPoints(latest: number | null | undefined, previous: number | null | undefined): number | null {
  const a = toPercent(latest);
  const b = toPercent(previous);
  return a == null || b == null ? null : a - b;
}

/** "+4", "-2", "0". */
export function formatDelta(points: number): string {
  return points > 0 ? `+${points}` : String(points);
}

/** `runs` is newest first; only completed runs serve as latest / previous (A13). */
export function latestCompleted(runs: AgentEvalRunSummary[]): AgentEvalRunSummary | null {
  return runs.find((r) => r.status === "completed") ?? null;
}

export function previousCompleted(runs: AgentEvalRunSummary[]): AgentEvalRunSummary | null {
  return runs.filter((r) => r.status === "completed")[1] ?? null;
}

export function runAllBlocker(cases: AgentEvalCaseListItem[], runs: AgentEvalRunSummary[]): RunAllBlocker | null {
  if (cases.length === 0) return "noCases";
  if (runs.some((r) => r.status === "running")) return "inProgress";
  return null;
}

export function progressOf(run: AgentEvalRunSummary): { done: number; total: number } {
  return { done: run.cases_done, total: run.cases_total };
}

export function formatStarted(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? NO_DATA : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

import type {
  AgentEvalRunSummary,
  EvalCaseCheck,
  EvalCaseLastRun,
  EvalCaseListItem,
  EvalRunStatus,
} from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { NO_DATA } from "@/lib/format";

/** A suite run of either owner: an agent run or a skill run (no `agent_id` needed). */
export type EvalSuiteRunLike = Omit<AgentEvalRunSummary, "agent_id">;

export type RunAllBlocker = "noCases" | "inProgress";

export type CaseRowState = "edited" | "never" | "passed" | "failed" | "errored";

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
export function latestCompleted<R extends { status: EvalRunStatus }>(runs: readonly R[]): R | null {
  return runs.find((r) => r.status === "completed") ?? null;
}

export function previousCompleted<R extends { status: EvalRunStatus }>(runs: readonly R[]): R | null {
  return runs.filter((r) => r.status === "completed")[1] ?? null;
}

export function runAllBlocker(
  cases: readonly unknown[],
  runs: readonly { status: EvalRunStatus }[],
): RunAllBlocker | null {
  if (cases.length === 0) return "noCases";
  if (runs.some((r) => r.status === "running")) return "inProgress";
  return null;
}

export function progressOf(run: Pick<AgentEvalRunSummary, "cases_done" | "cases_total">): {
  done: number;
  total: number;
} {
  return { done: run.cases_done, total: run.cases_total };
}

export function formatStarted(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? NO_DATA : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * The row's main result. A latest run result that covered an older revision of
 * the case reads "edited" (SPEC-06 AC13); a name-only edit keeps the revision.
 */
export function caseRowState(item: EvalCaseListItem): CaseRowState {
  const r = item.latest_result;
  if (!r) return "never";
  if (r.case_revision_id !== item.revision_id) return "edited";
  return r.status;
}

/** A finished single-case result as the last-run line; a running or absent check is `null`. */
export function checkToLastRun(check: EvalCaseCheck | null | undefined): EvalCaseLastRun | null {
  if (!check || check.status === "running") return null;
  return {
    source: "check",
    status: check.status,
    expected: check.expected,
    got: check.got,
    error: check.error,
    duration_ms: check.duration_ms,
    cost_usd: check.cost_usd,
    finished_at: check.finished_at ?? check.started_at,
  };
}

const DEFAULT_RETRY_AFTER_MS = 60_000;

/** Until when run starts stay disabled after a refused start (A8); `null` for any other error. */
export function rateLimitedUntil(err: unknown, nowMs: number): number | null {
  if (!(err instanceof ApiError) || err.code !== "run_start_rate_limited") return null;
  const details = err.details as { retry_after_ms?: unknown } | undefined;
  const retry = typeof details?.retry_after_ms === "number" ? details.retry_after_ms : DEFAULT_RETRY_AFTER_MS;
  return nowMs + retry;
}

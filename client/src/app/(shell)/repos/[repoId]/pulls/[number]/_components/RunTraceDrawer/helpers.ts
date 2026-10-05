import type { LogLine } from "@devdigest/ui";
import type { RunTrace, SpecUsed } from "@devdigest/shared";

interface RawEvent {
  t: string;
  kind: string;
  msg: string;
}

/** Map run-bus events to the LiveLogStream LogLine shape. */
export function eventsToLog(events: RawEvent[]): LogLine[] {
  return events.map((e) => ({ t: e.t, k: e.kind as LogLine["k"], m: e.msg }));
}

/** Map a persisted trace's log to the LiveLogStream LogLine shape. */
export function traceLog(trace: RunTrace | undefined): LogLine[] {
  return trace?.log.map((l) => ({ t: l.t, k: l.kind as LogLine["k"], m: l.msg })) ?? [];
}

/** Seconds-formatted duration. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Token in→out summary (e.g. "12k→1.5k"). */
export function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(0)}k→${(tokensOut / 1000).toFixed(1)}k`;
}

/** A "Specs read" row: tokens/truncated are absent for legacy path-only traces. */
export type SpecsReadRow = { path: string; tokens?: number; truncated?: boolean };

/** Rows for the "Specs read" list: `specs_used`, else legacy `specs_read` paths, else none. */
export function specsReadRows(trace: RunTrace): SpecsReadRow[] {
  const used: SpecUsed[] = trace.prompt_assembly.specs_used ?? [];
  if (used.length > 0) return used;
  return (trace.specs_read ?? []).map((path) => ({ path }));
}

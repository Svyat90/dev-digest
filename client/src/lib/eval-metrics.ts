/* Eval metric formatting shared by the workspace and agent eval dashboards.
   Pure and React-free: whole-point percents, signed deltas, em dash for unknown. */
import { formatUsd, NO_DATA } from "./format";

const MINUS = "−";

/** A 0..1 metric as a whole percent, or null when unknown. */
export function toPercent(v: number | null | undefined): number | null {
  return v == null ? null : Math.round(v * 100);
}

export function formatPercent(v: number | null | undefined): string {
  const p = toPercent(v);
  return p == null ? NO_DATA : `${p}%`;
}

/** Latest minus previous, in whole points; null when either side is unknown. */
export function deltaPoints(
  latest: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  const a = toPercent(latest);
  const b = toPercent(previous);
  return a == null || b == null ? null : a - b;
}

export function signedNumber(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${n}` : `${MINUS}${Math.abs(n)}`;
}

export function signedUsd(diff: number): string {
  if (diff === 0) return "$0";
  return `${diff > 0 ? "+" : MINUS}${formatUsd(Math.abs(diff))}`;
}

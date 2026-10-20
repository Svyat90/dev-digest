import type { EvalTrendPoint } from "@/vendor/shared";
import { toPercent } from "@/lib/eval-metrics";

export interface TrendRow {
  index: number;
  recall: number | null;
  precision: number | null;
  citation: number | null;
}

/** One chart row per completed run, whole percent; `null` stays a gap (AC11). */
export function trendRows(points: EvalTrendPoint[]): TrendRow[] {
  return points.map((p, index) => ({
    index,
    recall: toPercent(p.recall),
    precision: toPercent(p.precision),
    citation: toPercent(p.citation_accuracy),
  }));
}

export type EvalMetricKey = "recall" | "precision" | "citation_accuracy";

/** One colour per eval metric, shared by every eval screen (dashboard, tab, compare). */
export const EVAL_METRIC_COLOR: Record<EvalMetricKey, string> = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation_accuracy: "var(--warn)",
};

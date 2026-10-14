import type { EvalRegressionAlert } from "@devdigest/shared";

export type OthersSentenceKey = "othersBoth" | "othersEach" | "otherOne";

/** Which `eval.alert.*` sentence reports the metrics other than the dropped one (A7). */
export function othersSentenceKey(others: EvalRegressionAlert["others"]): OthersSentenceKey | null {
  if (others.length === 0) return null;
  if (others.length === 1) return "otherOne";
  return others[0]!.direction === others[1]!.direction ? "othersBoth" : "othersEach";
}

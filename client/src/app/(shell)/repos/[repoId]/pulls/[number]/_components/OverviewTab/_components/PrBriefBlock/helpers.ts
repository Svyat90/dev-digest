import type { BriefMissingInput, ReviewRecord, RiskFileRef } from "@devdigest/shared";
import { ApiError } from "@/lib/api";

/** `path:start` or `path:start-end`. */
export function refLabel(ref: RiskFileRef): string {
  return ref.end_line != null && ref.end_line !== ref.start_line
    ? `${ref.file}:${ref.start_line}-${ref.end_line}`
    : `${ref.file}:${ref.start_line}`;
}

/** The single newest full review (reviews arrive newest-first); summaries are skipped. */
export function newestReview(reviews: ReviewRecord[]): ReviewRecord | undefined {
  return reviews.find((r) => r.kind === "review");
}

/** Message key (inside the `brief` namespace) for a failed generation. */
export function failureMessageKey(
  error: unknown,
): "errors.invalidAnswer" | "errors.notConfigured" | "errors.providerUnavailable" {
  const code = error instanceof ApiError ? error.code : undefined;
  if (code === "invalid_model_answer") return "errors.invalidAnswer";
  if (code === "config_error") return "errors.notConfigured";
  return "errors.providerUnavailable";
}

export function missingLabelKeys(missing: BriefMissingInput[]): string[] {
  return missing.map((m) => `missing.${m}`);
}

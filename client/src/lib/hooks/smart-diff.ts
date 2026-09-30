/* hooks/smart-diff.ts — React Query hook for the Smart Diff grouping
   (GET /pulls/:id/smart-diff). Deterministic, no model call, works before the
   first review. Query key in keys.ts; invalidation lives beside the reviews
   hooks in reviews.ts (useInvalidateReviewResults and friends). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { SmartDiffResponse } from "@devdigest/shared";
import { keys } from "./keys";

/** Role groups + finding_lines for a PR's "Files changed" tab. */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: keys.smartDiff(prId),
    queryFn: () => api.get<SmartDiffResponse>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}

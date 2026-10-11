/* hooks/brief.ts — React Query hooks for the PR Brief
   (GET /pulls/:id/brief, POST /pulls/:id/brief). Query key in keys.ts; the
   generate mutation writes its result straight into the cache and leaves it
   untouched on failure. Nothing generates without a user action. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrBrief } from "@devdigest/shared";
import { keys } from "./keys";

/** `null` = no brief generated yet for this PR. Read-only. */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: keys.brief(prId),
    queryFn: () => api.get<PrBrief | null>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    // Body-less POST: apiFetch must not declare a JSON content-type for it.
    mutationFn: () => api.post<PrBrief>(`/pulls/${prId}/brief`),
    onSuccess: (data) => qc.setQueryData(keys.brief(prId), data),
  });
}

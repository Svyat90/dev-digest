/* hooks/blast.ts — React Query hooks for the blast-radius card
   (GET /pulls/:id/blast, GET /pulls/:id/history). Query keys in keys.ts; the
   Resync button's invalidation of `keys.blastAll()` lives in hooks/repo-intel.ts. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadiusResponse, PrHistoryResponse } from "@devdigest/shared";
import { keys } from "./keys";

/** Callers / endpoints / crons reached by the symbols a PR changes (index read, no LLM). */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: keys.blast(prId),
    queryFn: () => api.get<BlastRadiusResponse>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}

/** Prior merged PRs touching the same files. `enabled` gates the fetch on the footer being opened. */
export function usePrHistory(prId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.prHistory(prId),
    queryFn: () => api.get<PrHistoryResponse>(`/pulls/${prId}/history`),
    enabled: !!prId && enabled,
  });
}

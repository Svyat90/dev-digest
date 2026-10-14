/* hooks/evals.ts — React Query hooks for the eval pipeline (SPEC-04):
   the agent's case list, its eval runs (polled while one is running) and the
   "Turn into eval case" action on a finding. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentEvalCaseListItem,
  AgentEvalRunSummary,
  CreateEvalCaseResponse,
  StartEvalRunResponse,
} from "@devdigest/shared";
import { keys } from "./keys";

/** Eval cases of one agent, each with its latest result (null = never run). */
export function useAgentEvalCases(
  agentId: string | null | undefined,
  opts?: { refetchIntervalMs?: number | false },
) {
  return useQuery({
    queryKey: keys.agentEvalCases(agentId),
    queryFn: () => api.get<AgentEvalCaseListItem[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
    refetchInterval: opts?.refetchIntervalMs ?? false,
  });
}

/** Eval run history of one agent, newest first. Polls every 2 s while any run
   is running so progress and the final result appear without a reload. */
export function useAgentEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: keys.agentEvalRuns(agentId),
    queryFn: () => api.get<AgentEvalRunSummary[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
    refetchInterval: (query) =>
      query.state.data?.some((r) => r.status === "running") ? 2000 : false,
  });
}

/** Start an eval run over all of the agent's cases (answers before any case runs). */
export function useStartEvalRun(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<StartEvalRunResponse>(`/agents/${agentId}/eval-runs`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.agentEvalRuns(agentId) });
      qc.invalidateQueries({ queryKey: keys.evalDashboard() });
      qc.invalidateQueries({ queryKey: keys.agentEvalDashboardAll(agentId) });
    },
  });
}

/** Delete one eval case (past results keep their rows, server-side). */
export function useDeleteEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<{ ok: true }>(`/eval-cases/${caseId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.agentEvalCases(agentId) });
    },
  });
}

/** Turn a finding into an eval case. The PR's reviews are refetched so the
   card flips to "Eval case exists". */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId }: { findingId: string }) =>
      api.post<CreateEvalCaseResponse>(`/findings/${findingId}/eval-case`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: keys.reviews(data.case.provenance.pr_id) });
      qc.invalidateQueries({ queryKey: keys.agentEvalCases(data.case.agent_id) });
    },
  });
}

export interface FindingEvalCaseControl {
  onCreate: () => void;
  pending: boolean;
  errorCode: string | null;
}

/** Per-finding view of the one create mutation: only the finding the mutation
   was fired for reports `pending` / `errorCode`. */
export function useFindingEvalCaseAction(): (findingId: string) => FindingEvalCaseControl {
  const m = useCreateEvalCase();
  return (findingId) => {
    const mine = m.variables?.findingId === findingId;
    return {
      onCreate: () => m.mutate({ findingId }),
      pending: m.isPending && mine,
      errorCode: m.isError && mine ? ((m.error as { code?: string }).code ?? null) : null,
    };
  };
}

/* hooks/eval-dashboard.ts — React Query hooks for the eval dashboards (SPEC-05):
   the workspace overview, the per-agent dashboard, run comparison, Run all and
   Promote. Pages showing a running run poll every 3 s. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalDashboard,
  EvalDashboardRange,
  EvalRunComparison,
  EvalWorkspaceDashboard,
  PromoteEvalRunResponse,
  RunAllEvalsResponse,
} from "@devdigest/shared";
import { keys } from "./keys";

const POLL_MS = 3000;

/** Every agent's latest eval result plus the 20 newest runs. */
export function useEvalDashboard() {
  return useQuery({
    queryKey: keys.evalDashboard(),
    queryFn: () => api.get<EvalWorkspaceDashboard>("/eval-dashboard"),
    refetchInterval: (query) => {
      const d = query.state.data;
      const running =
        d?.agents.some((a) => a.running) || d?.recent_runs.some((r) => r.status === "running");
      return running ? POLL_MS : false;
    },
  });
}

/** Start one run per eligible agent (counts once against the start limit). */
export function useRunAllEvals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RunAllEvalsResponse>("/eval-dashboard/run-all"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.evalDashboard() });
      qc.invalidateQueries({ queryKey: keys.agentEvalDashboardPrefix() });
      qc.invalidateQueries({ queryKey: keys.agentEvalRunsAll() });
    },
  });
}

/** One agent's dashboard for a range. */
export function useAgentEvalDashboard(
  agentId: string | null | undefined,
  range: EvalDashboardRange,
) {
  return useQuery({
    queryKey: keys.agentEvalDashboard(agentId, range),
    queryFn: () =>
      api.get<EvalDashboard>(`/agents/${agentId}/eval-dashboard?range=${range}`),
    enabled: !!agentId,
    refetchInterval: (query) => {
      const d = query.state.data;
      const running = !!d?.running_run || d?.runs?.some((r) => r.status === "running");
      return running ? POLL_MS : false;
    },
  });
}

/** Compare two completed runs; idle until both ids are chosen. */
export function useEvalRunComparison(
  agentId: string,
  runIds: readonly [string, string] | null,
) {
  const [a, b] = runIds ?? [null, null];
  return useQuery({
    queryKey: keys.evalRunComparison(agentId, a, b),
    queryFn: () =>
      api.get<EvalRunComparison>(`/agents/${agentId}/eval-runs/compare?a=${a}&b=${b}`),
    enabled: !!runIds,
  });
}

/** Promote a run's configuration (agent version + skill bodies, one transaction). */
export function usePromoteEvalRun(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      api.post<PromoteEvalRunResponse>(`/agents/${agentId}/eval-runs/${runId}/promote`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: keys.agentEvalDashboardAll(agentId) });
      qc.invalidateQueries({ queryKey: keys.evalDashboard() });
      qc.invalidateQueries({ queryKey: keys.evalRunComparisonAll() });
      qc.invalidateQueries({ queryKey: keys.agents() });
      qc.invalidateQueries({ queryKey: keys.agent(agentId) });
      qc.invalidateQueries({ queryKey: keys.agentSkills(agentId) });
      qc.invalidateQueries({ queryKey: keys.agentEvalRuns(agentId) });
      qc.invalidateQueries({ queryKey: keys.skills() });
      for (const s of data.restored_skills) {
        qc.invalidateQueries({ queryKey: keys.skill(s.skill_id) });
        qc.invalidateQueries({ queryKey: keys.skillVersions(s.skill_id) });
      }
    },
  });
}

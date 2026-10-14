/* hooks/eval-cases.ts — React Query hooks for the Case Editor and the skill
   Evals tab (SPEC-06): one case of either owner (polled while its single-case
   run is running), create / update / run one case, and a skill's cases, runs
   and remembered agent. Agent case lists stay in ./evals (SPEC-04). */
"use client";

import { useQuery, useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalCaseDetail,
  EvalCaseDraft,
  EvalCaseListItem,
  EvalCaseOwner,
  SaveEvalCaseResponse,
  SetSkillEvalAgentBody,
  SkillEvalAgent,
  SkillEvalRunSummary,
  StartEvalCaseCheckResponse,
  StartEvalRunResponse,
} from "@devdigest/shared";
import { keys } from "./keys";

const POLL_MS = 2000;

function ownerPath(owner: EvalCaseOwner): string {
  return `/${owner.kind === "skill" ? "skills" : "agents"}/${owner.id}/eval-cases`;
}

/** The owner's case list key: SPEC-04's agent key, or the skill's own. */
function ownerListKey(owner: EvalCaseOwner) {
  return owner.kind === "skill" ? keys.skillEvalCases(owner.id) : keys.agentEvalCases(owner.id);
}

/** One case with its content, latest results and newest single-case result.
   Polls every 2 s while that single-case run is running. */
export function useEvalCase(
  owner: EvalCaseOwner,
  caseId: string | null,
): UseQueryResult<EvalCaseDetail, Error> {
  return useQuery({
    queryKey: keys.evalCase(owner.kind, owner.id, caseId),
    queryFn: () => api.get<EvalCaseDetail>(`${ownerPath(owner)}/${caseId}`),
    enabled: !!caseId,
    refetchInterval: (query) => (query.state.data?.check?.status === "running" ? POLL_MS : false),
  });
}

/** Create a manual case in the owner's set. */
export function useCreateEvalCaseDraft(owner: EvalCaseOwner) {
  const qc = useQueryClient();
  return useMutation<SaveEvalCaseResponse, Error, EvalCaseDraft>({
    mutationFn: (draft) => api.post<SaveEvalCaseResponse>(ownerPath(owner), draft),
    onSuccess: (data) => {
      qc.setQueryData(keys.evalCase(owner.kind, owner.id, data.case.id), data.case);
      qc.invalidateQueries({ queryKey: ownerListKey(owner) });
      qc.invalidateQueries({ queryKey: keys.evalCase(owner.kind, owner.id, data.case.id) });
    },
  });
}

/** Save a case: a content change stores a new revision, a name-only edit does not. */
export function useUpdateEvalCase(owner: EvalCaseOwner) {
  const qc = useQueryClient();
  return useMutation<SaveEvalCaseResponse, Error, { caseId: string; draft: EvalCaseDraft }>({
    mutationFn: ({ caseId, draft }) =>
      api.put<SaveEvalCaseResponse>(`${ownerPath(owner)}/${caseId}`, draft),
    onSuccess: (data, { caseId }) => {
      qc.setQueryData(keys.evalCase(owner.kind, owner.id, caseId), data.case);
      qc.invalidateQueries({ queryKey: ownerListKey(owner) });
      qc.invalidateQueries({ queryKey: keys.evalCase(owner.kind, owner.id, caseId) });
    },
  });
}

/** Start a single-case run (a scratch check, never in run history). Body-less POST. */
export function useStartEvalCaseCheck(owner: EvalCaseOwner) {
  const qc = useQueryClient();
  return useMutation<StartEvalCaseCheckResponse, Error, string>({
    mutationFn: (caseId) => api.post<StartEvalCaseCheckResponse>(`${ownerPath(owner)}/${caseId}/check`),
    onSuccess: (_data, caseId) => {
      qc.invalidateQueries({ queryKey: ownerListKey(owner) });
      qc.invalidateQueries({ queryKey: keys.evalCase(owner.kind, owner.id, caseId) });
    },
  });
}

/** Eval cases of one skill, each with its latest result and single-case result. */
export function useSkillEvalCases(
  skillId: string | null | undefined,
  opts?: { refetchIntervalMs?: number | false },
): UseQueryResult<EvalCaseListItem[], Error> {
  return useQuery({
    queryKey: keys.skillEvalCases(skillId),
    queryFn: () => api.get<EvalCaseListItem[]>(`/skills/${skillId}/eval-cases`),
    enabled: !!skillId,
    refetchInterval: opts?.refetchIntervalMs ?? false,
  });
}

/** Delete one skill case through SPEC-04's workspace-scoped route. */
export function useDeleteSkillEvalCase(skillId: string) {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, string>({
    mutationFn: (caseId) => api.del<{ ok: true }>(`/eval-cases/${caseId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.skillEvalCases(skillId) });
    },
  });
}

/** Eval run history of one skill, newest first. Polls every 2 s while any run is running. */
export function useSkillEvalRuns(
  skillId: string | null | undefined,
): UseQueryResult<SkillEvalRunSummary[], Error> {
  return useQuery({
    queryKey: keys.skillEvalRuns(skillId),
    queryFn: () => api.get<SkillEvalRunSummary[]>(`/skills/${skillId}/eval-runs`),
    enabled: !!skillId,
    refetchInterval: (query) =>
      query.state.data?.some((r) => r.status === "running") ? POLL_MS : false,
  });
}

/** Run all of a skill's cases through its remembered agent. Body-less POST. */
export function useStartSkillEvalRun(skillId: string) {
  const qc = useQueryClient();
  return useMutation<StartEvalRunResponse, Error, void>({
    mutationFn: () => api.post<StartEvalRunResponse>(`/skills/${skillId}/eval-runs`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.skillEvalRuns(skillId) });
      qc.invalidateQueries({ queryKey: keys.skillEvalCases(skillId) });
    },
  });
}

/** The agent a skill's evals run through (or the name of a deleted one). */
export function useSkillEvalAgent(
  skillId: string | null | undefined,
): UseQueryResult<SkillEvalAgent, Error> {
  return useQuery({
    queryKey: keys.skillEvalAgent(skillId),
    queryFn: () => api.get<SkillEvalAgent>(`/skills/${skillId}/eval-agent`),
    enabled: !!skillId,
  });
}

/** Remember the agent a skill's evals run through. */
export function useSetSkillEvalAgent(skillId: string) {
  const qc = useQueryClient();
  return useMutation<SkillEvalAgent, Error, string>({
    mutationFn: (agentId) => {
      const body: SetSkillEvalAgentBody = { agent_id: agentId };
      return api.put<SkillEvalAgent>(`/skills/${skillId}/eval-agent`, body);
    },
    onSuccess: (data) => {
      qc.setQueryData(keys.skillEvalAgent(skillId), data);
    },
  });
}

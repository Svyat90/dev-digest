/* hooks/project-context.ts — React Query hooks for Project Context: the repo's
   markdown document list/preview, usage, and the agent/skill attachments
   (GET/PUT/POST /agents|skills/:id/context-docs). Server state stays in the
   cache; mutations invalidate it rather than mirroring it. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentContextDocs,
  ContextDocContent,
  ContextDocList,
  ContextDocPaths,
  ContextDocUsage,
  SkillContextDocs,
} from "@devdigest/shared";
import { keys } from "./keys";

function qs(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

// ---- Repo document browser ----
export function useContextDocs(repoId: string | null | undefined, q = "") {
  return useQuery({
    queryKey: keys.contextDocs(repoId, q),
    queryFn: () =>
      api.get<ContextDocList>(`/repos/${repoId}/context/docs${q ? `?${qs({ q })}` : ""}`),
    enabled: !!repoId,
  });
}

export function useContextDoc(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: keys.contextDoc(repoId, path),
    queryFn: () =>
      api.get<ContextDocContent>(`/repos/${repoId}/context/docs/content?${qs({ path: path ?? "" })}`),
    enabled: !!repoId && !!path,
  });
}

export function useContextDocUsage(path: string | null | undefined) {
  return useQuery({
    queryKey: keys.contextDocUsage(path),
    queryFn: () => api.get<ContextDocUsage>(`/context-docs/usage?${qs({ path: path ?? "" })}`),
    enabled: !!path,
  });
}

// ---- Agent attachments ----
export function useAgentContextDocs(
  agentId: string | null | undefined,
  repoId: string | null | undefined,
) {
  return useQuery({
    queryKey: keys.agentContextDocs(agentId, repoId),
    queryFn: () =>
      api.get<AgentContextDocs>(`/agents/${agentId}/context-docs?${qs({ repo_id: repoId ?? "" })}`),
    enabled: !!agentId && !!repoId,
  });
}

/** Replaces the agent's full ordered document list in one PUT. Optimistic:
   `own` is re-ordered/filtered in the cache before the request lands and
   rolled back on failure. */
export function useSetAgentContextDocs(
  agentId: string | null | undefined,
  repoId: string | null | undefined,
) {
  const qc = useQueryClient();
  const key = keys.agentContextDocs(agentId, repoId);
  return useMutation({
    mutationFn: (paths: string[]) =>
      api.put<ContextDocPaths>(`/agents/${agentId}/context-docs`, { paths }),
    onMutate: async (paths) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<AgentContextDocs>(key);
      if (previous) {
        const byPath = new Map(previous.own.map((d) => [d.path, d]));
        qc.setQueryData<AgentContextDocs>(key, {
          ...previous,
          own: paths.map(
            (path) =>
              byPath.get(path) ?? { path, type: null, found: true, tokens: null, truncated: false },
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _paths, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: keys.contextDocUsageAll() });
    },
  });
}

export function useAttachDocToAgent(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      api.post<ContextDocPaths>(`/agents/${agentId}/context-docs`, { path }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.agentContextDocsAll() });
      qc.invalidateQueries({ queryKey: keys.contextDocUsageAll() });
    },
  });
}

// ---- Skill attachments ----
export function useSkillContextDocs(
  skillId: string | null | undefined,
  repoId: string | null | undefined,
) {
  return useQuery({
    queryKey: keys.skillContextDocs(skillId, repoId),
    queryFn: () =>
      api.get<SkillContextDocs>(`/skills/${skillId}/context-docs?${qs({ repo_id: repoId ?? "" })}`),
    enabled: !!skillId && !!repoId,
  });
}

// A skill's documents are inherited by every agent that uses it, so each skill
// mutation also invalidates every agent's context-docs query.
function invalidateAfterSkillChange(qc: ReturnType<typeof useQueryClient>, skillKey: readonly unknown[]) {
  qc.invalidateQueries({ queryKey: skillKey });
  qc.invalidateQueries({ queryKey: keys.agentContextDocsAll() });
  qc.invalidateQueries({ queryKey: keys.contextDocUsageAll() });
}

export function useSetSkillContextDocs(
  skillId: string | null | undefined,
  repoId: string | null | undefined,
) {
  const qc = useQueryClient();
  const key = keys.skillContextDocs(skillId, repoId);
  return useMutation({
    mutationFn: (paths: string[]) =>
      api.put<ContextDocPaths>(`/skills/${skillId}/context-docs`, { paths }),
    onMutate: async (paths) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<SkillContextDocs>(key);
      if (previous) {
        const byPath = new Map(previous.own.map((d) => [d.path, d]));
        qc.setQueryData<SkillContextDocs>(key, {
          ...previous,
          own: paths.map(
            (path) =>
              byPath.get(path) ?? { path, type: null, found: true, tokens: null, truncated: false },
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _paths, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => invalidateAfterSkillChange(qc, key),
  });
}

export function useAttachDocToSkill(skillId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      api.post<ContextDocPaths>(`/skills/${skillId}/context-docs`, { path }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["skill-context-docs", skillId] });
      qc.invalidateQueries({ queryKey: keys.agentContextDocsAll() });
      qc.invalidateQueries({ queryKey: keys.contextDocUsageAll() });
    },
  });
}

"use client";

import React from "react";
import { ApiError } from "@/lib/api";
import {
  useSetSkillEvalAgent,
  useSkillEvalAgent,
  useSkillEvalCases,
  useSkillEvalRuns,
  useStartSkillEvalRun,
} from "@/lib/hooks/eval-cases";
import { rateLimitedUntil } from "@/components/eval-suite";
import { AgentPickerDialog } from "./AgentPickerDialog";
import { needsAgent, skillRunBlocker } from "./helpers";

export interface SkillEvalRunControl {
  agent: { id: string; name: string } | null;
  missingAgentName: string | null;
  blocker: "noCases" | "inProgress" | null;
  pending: boolean;
  errorCode: string | null;
  rateLimited: boolean;
  run: () => void;
  changeAgent: () => void;
  picker: React.JSX.Element | null;
}

/** Why the picker is open: to start a run after the pick, or only to change the agent. */
type PickerMode = "run" | "change";

function codeOf(err: Error | null): string | null {
  if (!err) return null;
  return err instanceof ApiError && err.code ? err.code : "generic";
}

/**
 * A skill's eval run through its remembered agent (SPEC-06 AC18, AC21): asks
 * for an agent once, remembers it, and starts the run; everything but the
 * picker's open state is derived from the queries and mutations.
 */
export function useSkillEvalRun(skillId: string): SkillEvalRunControl {
  const agentQ = useSkillEvalAgent(skillId);
  const casesQ = useSkillEvalCases(skillId);
  const runsQ = useSkillEvalRuns(skillId);
  const setAgent = useSetSkillEvalAgent(skillId);
  const start = useStartSkillEvalRun(skillId);
  const [pickerMode, setPickerMode] = React.useState<PickerMode | null>(null);

  const evalAgent = agentQ.data;
  const blocker = skillRunBlocker(casesQ.data ?? [], runsQ.data ?? []);
  const until = rateLimitedUntil(start.error, start.submittedAt);
  const rateLimited = until !== null && Date.now() < until;

  // Re-enable once the refused start's retry window has passed (A8).
  const resetStart = start.reset;
  React.useEffect(() => {
    if (until === null) return;
    const id = setTimeout(resetStart, Math.max(0, until - Date.now()));
    return () => clearTimeout(id);
  }, [until, resetStart]);

  const run = () => {
    if (needsAgent(evalAgent)) setPickerMode("run");
    else start.mutate();
  };

  const confirmPick = (agentId: string) => {
    const mode = pickerMode;
    setAgent.mutate(agentId, {
      onSuccess: () => {
        setPickerMode(null);
        if (mode === "run") start.mutate();
      },
    });
  };

  const picker =
    pickerMode === null
      ? null
      : React.createElement(AgentPickerDialog, {
          currentAgentId: evalAgent?.agent?.id ?? null,
          missingAgentName: evalAgent?.missing_agent_name ?? null,
          pending: setAgent.isPending,
          onConfirm: confirmPick,
          onCancel: () => setPickerMode(null),
        });

  return {
    agent: evalAgent?.agent ?? null,
    missingAgentName: evalAgent?.missing_agent_name ?? null,
    blocker,
    pending: setAgent.isPending || start.isPending,
    errorCode: codeOf(start.error) ?? codeOf(setAgent.error),
    rateLimited,
    run,
    changeAgent: () => setPickerMode("change"),
    picker,
  };
}

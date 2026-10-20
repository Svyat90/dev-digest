/* Pure rules for the workspace Eval Dashboard: what "Run all agents" would do
   and which line an agent row shows. */
import type { EvalWorkspaceAgentRow, RunAllEvalsSkipReason } from "@devdigest/shared";

export interface RunAllPlan {
  runnable: number;
  totalCases: number;
  skipped: { name: string; reason: RunAllEvalsSkipReason }[];
  blocker: "noCases" | "allRunning" | null;
}

export function runAllPlan(agents: readonly EvalWorkspaceAgentRow[]): RunAllPlan {
  let runnable = 0;
  let totalCases = 0;
  let withCases = 0;
  const skipped: RunAllPlan["skipped"] = [];
  for (const a of agents) {
    if (a.cases_total === 0) {
      skipped.push({ name: a.name, reason: "no_eval_cases" });
      continue;
    }
    withCases += 1;
    if (a.running) {
      skipped.push({ name: a.name, reason: "eval_run_in_progress" });
      continue;
    }
    runnable += 1;
    totalCases += a.cases_total;
  }
  const blocker = runnable > 0 ? null : withCases > 0 ? "allRunning" : "noCases";
  return { runnable, totalCases, skipped, blocker };
}

export function agentRowState(agent: EvalWorkspaceAgentRow): "run" | "neverRun" | "noCases" {
  if (agent.latest) return "run";
  return agent.cases_total === 0 ? "noCases" : "neverRun";
}

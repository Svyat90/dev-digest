import { describe, it, expect } from "vitest";
import type { EvalWorkspaceAgentRow } from "@devdigest/shared";
import { runAllPlan, agentRowState } from "./helpers";

const mk = (id: string, cases: number, running = false): EvalWorkspaceAgentRow => ({
  id,
  name: `agent-${id}`,
  provider: "openai",
  model: "gpt-4o",
  enabled: true,
  cases_total: cases,
  running,
  latest: null,
  recall_trend: [],
});

describe("runAllPlan", () => {
  it("counts runnable agents and names the skipped ones with a reason", () => {
    const plan = runAllPlan([mk("a", 3), mk("b", 0), mk("c", 5, true)]);
    expect(plan.runnable).toBe(1);
    expect(plan.totalCases).toBe(3);
    expect(plan.blocker).toBeNull();
    expect(plan.skipped).toEqual([
      { name: "agent-b", reason: "no_eval_cases" },
      { name: "agent-c", reason: "eval_run_in_progress" },
    ]);
  });

  it("blocks with noCases when nothing has cases, allRunning when all are running", () => {
    expect(runAllPlan([]).blocker).toBe("noCases");
    expect(runAllPlan([mk("a", 0)]).blocker).toBe("noCases");
    expect(runAllPlan([mk("a", 2, true), mk("b", 1, true)]).blocker).toBe("allRunning");
  });
});

describe("agentRowState", () => {
  it("distinguishes no cases, never run and a run", () => {
    expect(agentRowState(mk("a", 0))).toBe("noCases");
    expect(agentRowState(mk("a", 2))).toBe("neverRun");
    expect(agentRowState({ ...mk("a", 2), latest: {} as never })).toBe("run");
  });
});

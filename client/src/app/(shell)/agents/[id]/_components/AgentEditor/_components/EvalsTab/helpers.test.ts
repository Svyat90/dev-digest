import { describe, it, expect } from "vitest";
import type { AgentEvalRunSummary } from "@devdigest/shared";
import { deltaPoints, formatPercent, latestCompleted, previousCompleted, runAllBlocker } from "./helpers";

const run = (id: string, status: AgentEvalRunSummary["status"]): AgentEvalRunSummary => ({
  id,
  agent_id: "ag1",
  status,
  started_at: "2026-10-12T10:00:00.000Z",
  finished_at: null,
  duration_ms: null,
  agent_version: 1,
  cases_total: 2,
  cases_done: 0,
  cases_scored: 0,
  cases_passed: 0,
  recall: null,
  precision: null,
  citation_accuracy: null,
  cost_usd: null,
  error: null,
});

describe("EvalsTab helpers", () => {
  it("deltaPoints is the whole-percent difference and null when a side is missing", () => {
    expect(deltaPoints(0.82, 0.78)).toBe(4);
    expect(deltaPoints(0.82, null)).toBeNull();
    expect(deltaPoints(null, 0.5)).toBeNull();
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0.825)).toBe("83%");
  });

  it("latest and previous skip failed and running runs", () => {
    const runs = [run("r4", "running"), run("r3", "failed"), run("r2", "completed"), run("r1", "completed")];
    expect(latestCompleted(runs)?.id).toBe("r2");
    expect(previousCompleted(runs)?.id).toBe("r1");
    expect(latestCompleted([run("x", "failed")])).toBeNull();
  });

  it("runAllBlocker names why Run all evals is off", () => {
    expect(runAllBlocker([], [])).toBe("noCases");
    expect(runAllBlocker([{}] as never, [run("r1", "running")])).toBe("inProgress");
    expect(runAllBlocker([{}] as never, [run("r1", "completed")])).toBeNull();
  });
});

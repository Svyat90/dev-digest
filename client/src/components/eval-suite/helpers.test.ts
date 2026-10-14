import { describe, it, expect } from "vitest";
import type { AgentEvalRunSummary, EvalCaseCheck, EvalCaseListItem } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import {
  caseRowState,
  checkToLastRun,
  latestCompleted,
  previousCompleted,
  rateLimitedUntil,
  runAllBlocker,
} from "./helpers";

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

const item = (over: Partial<EvalCaseListItem> = {}): EvalCaseListItem => ({
  id: "c1",
  agent_id: "ag1",
  name: "case-one",
  revision_id: "rev-2",
  revision: 2,
  expectation_type: "must_not_flag",
  expectation: { file: "src/a.ts", start_line: 1, end_line: 2 },
  input_file: "src/a.ts",
  input_meta: { pr_title: "t", pr_description: "" },
  provenance: null,
  created_at: "2026-10-12T10:00:00.000Z",
  latest_result: null,
  check: null,
  ...over,
});

const check = (over: Partial<EvalCaseCheck> = {}): EvalCaseCheck => ({
  id: "k1",
  case_revision_id: "rev-2",
  status: "passed",
  started_at: "2026-10-12T10:00:00.000Z",
  finished_at: "2026-10-12T10:00:03.000Z",
  duration_ms: 3000,
  expected: 0,
  got: 0,
  error: null,
  cost_usd: 0.01,
  ...over,
});

describe("eval-suite helpers", () => {
  it("latest and previous skip failed and running runs", () => {
    const runs = [run("r4", "running"), run("r3", "failed"), run("r2", "completed"), run("r1", "completed")];
    expect(latestCompleted(runs)?.id).toBe("r2");
    expect(previousCompleted(runs)?.id).toBe("r1");
    expect(latestCompleted([run("x", "failed")])).toBeNull();
  });

  it("runAllBlocker names why Run all evals is off", () => {
    expect(runAllBlocker([], [])).toBe("noCases");
    expect(runAllBlocker([{}], [run("r1", "running")])).toBe("inProgress");
    expect(runAllBlocker([{}], [run("r1", "completed")])).toBeNull();
  });

  it("caseRowState reads edited when the latest result covered an older revision", () => {
    const result = { eval_run_id: "r1", status: "passed" as const, expected: 0, got: 0, error: null };
    expect(caseRowState(item({ latest_result: { ...result, case_revision_id: "rev-1" } }))).toBe("edited");
    expect(caseRowState(item({ latest_result: { ...result, case_revision_id: "rev-2" } }))).toBe("passed");
    expect(caseRowState(item())).toBe("never");
  });

  it("checkToLastRun hides a running check and maps a finished one", () => {
    expect(checkToLastRun(check({ status: "running", finished_at: null }))).toBeNull();
    expect(checkToLastRun(null)).toBeNull();
    expect(checkToLastRun(check())).toMatchObject({ source: "check", status: "passed", duration_ms: 3000 });
  });

  it("rateLimitedUntil reads retry_after_ms from a 429 and ignores other errors", () => {
    const now = 1_000_000;
    const limited = new ApiError("slow down", 429, "run_start_rate_limited", { retry_after_ms: 30000 });
    expect(rateLimitedUntil(limited, now)).toBe(now + 30_000);
    expect(rateLimitedUntil(new ApiError("slow down", 429, "run_start_rate_limited"), now)).toBe(now + 60_000);
    expect(rateLimitedUntil(new ApiError("nope", 409, "eval_run_in_progress"), now)).toBeNull();
  });
});

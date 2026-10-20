import { describe, it, expect } from "vitest";
import type { AgentEvalRunSummary } from "@devdigest/shared";
import { parseRange, rangeDays, runEvalBlocker, selectedPair } from "./helpers";

const run = (id: string, status: AgentEvalRunSummary["status"] = "completed"): AgentEvalRunSummary => ({
  id,
  agent_id: "a1",
  status,
  started_at: "2026-10-12T10:00:00.000Z",
  finished_at: null,
  duration_ms: null,
  agent_version: 1,
  cases_total: 4,
  cases_done: 4,
  cases_scored: 4,
  cases_passed: 4,
  recall: 1,
  precision: 1,
  citation_accuracy: 1,
  cost_usd: null,
  error: null,
});

describe("parseRange", () => {
  it("reads known values and falls back to 30d", () => {
    expect(parseRange("90d")).toBe("90d");
    expect(parseRange("banana")).toBe("30d");
    expect(parseRange(null)).toBe("30d");
  });
  it("maps a range to a number of days, all to null", () => {
    expect(rangeDays("7d")).toBe(7);
    expect(rangeDays("all")).toBeNull();
  });
});

describe("runEvalBlocker", () => {
  it("names why a run cannot start", () => {
    expect(runEvalBlocker(0, null)).toBe("noCases");
    expect(runEvalBlocker(3, run("r", "running"))).toBe("inProgress");
    expect(runEvalBlocker(3, null)).toBeNull();
  });
});

describe("selectedPair", () => {
  const runs = [run("a"), run("b"), run("c"), run("d", "running")];
  it("returns the pair of exactly two completed runs still listed", () => {
    expect(selectedPair(["a", "b"], runs)).toEqual(["a", "b"]);
  });
  it("returns null for three, one, an unlisted id or a running run", () => {
    expect(selectedPair(["a", "b", "c"], runs)).toBeNull();
    expect(selectedPair(["a"], runs)).toBeNull();
    expect(selectedPair(["a", "gone"], runs)).toBeNull();
    expect(selectedPair(["a", "d"], runs)).toBeNull();
  });
});

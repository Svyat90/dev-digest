import { describe, it, expect } from "vitest";
import type { EvalTrendPoint } from "@/vendor/shared";
import { trendRows } from "./helpers";

const point = (over: Partial<EvalTrendPoint>): EvalTrendPoint => ({
  run_id: "r1",
  started_at: "2026-10-01T10:00:00Z",
  agent_version: 3,
  recall: 0.823,
  precision: 0.5,
  citation_accuracy: null,
  cost_usd: null,
  ...over,
});

describe("trendRows", () => {
  it("rounds to whole percent and keeps unknown values as null gaps", () => {
    const rows = trendRows([point({}), point({ run_id: "r2", recall: null })]);
    expect(rows[0]).toMatchObject({ index: 0, recall: 82, precision: 50, citation: null });
    expect(rows[1]).toMatchObject({ index: 1, recall: null });
  });
});

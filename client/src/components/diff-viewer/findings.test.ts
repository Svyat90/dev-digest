/**
 * Findings-in-diff logic — the two rules that decide where a finding renders:
 * which rendered line (if any) it lands on, and which severity wins when a
 * line carries more than one finding.
 */
import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { partitionFindings, topSeverity } from "./findings";

const finding = (over: Partial<FindingRecord> & { id: string }): FindingRecord =>
  ({
    severity: "WARNING",
    category: "bug",
    title: "t",
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    confidence: 0.5,
    review_id: "rev",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  }) as FindingRecord;

describe("partitionFindings", () => {
  it("puts a finding under RIGHT:<start_line> when that line is rendered, else off-patch", () => {
    const rendered = new Set(["RIGHT:12"]);
    const onPatch = finding({ id: "on-patch", start_line: 12 });
    const offPatch = finding({ id: "off-patch", start_line: 40 });

    const { matched, offPatch: unmatched } = partitionFindings([onPatch, offPatch], rendered);

    expect(matched.get("RIGHT:12")?.map((f) => f.id)).toEqual(["on-patch"]);
    expect(unmatched.map((f) => f.id)).toEqual(["off-patch"]);
  });
});

describe("topSeverity", () => {
  it("ignores dismissed findings and returns CRITICAL over WARNING", () => {
    const result = topSeverity([
      finding({ id: "dismissed-crit", severity: "CRITICAL", dismissed_at: "2026-01-01T00:00:00Z" }),
      finding({ id: "warn", severity: "WARNING" }),
      finding({ id: "crit", severity: "CRITICAL" }),
    ]);
    expect(result).toBe("CRITICAL");
  });

  it("returns null when every finding is dismissed", () => {
    const result = topSeverity([
      finding({ id: "a", severity: "CRITICAL", dismissed_at: "2026-01-01T00:00:00Z" }),
    ]);
    expect(result).toBeNull();
  });
});

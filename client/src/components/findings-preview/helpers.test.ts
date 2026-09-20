/**
 * Preview helpers — the parts of the hover card jsdom cannot exercise: which
 * five findings out of many get shown, and where the fixed-position card lands
 * relative to a viewport (jsdom does no layout, so the geometry is tested here
 * as pure arithmetic rather than through a render).
 */
import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import {
  anchorFor,
  countBySeverity,
  lineLabel,
  sortForPreview,
  CARD_MAX_HEIGHT,
  CARD_WIDTH,
} from "./helpers";

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

describe("sortForPreview", () => {
  it("ranks by severity first, then by confidence descending", () => {
    const sorted = sortForPreview([
      finding({ id: "sugg", severity: "SUGGESTION", confidence: 0.99 }),
      finding({ id: "warn-low", severity: "WARNING", confidence: 0.2 }),
      finding({ id: "crit", severity: "CRITICAL", confidence: 0.4 }),
      finding({ id: "warn-high", severity: "WARNING", confidence: 0.9 }),
    ]);
    expect(sorted.map((f) => f.id)).toEqual(["crit", "warn-high", "warn-low", "sugg"]);
  });

  it("sends an unknown severity to the back instead of to the front", () => {
    const sorted = sortForPreview([
      finding({ id: "weird", severity: "WEIRD" as FindingRecord["severity"], confidence: 1 }),
      finding({ id: "sugg", severity: "SUGGESTION", confidence: 0.1 }),
    ]);
    expect(sorted.map((f) => f.id)).toEqual(["sugg", "weird"]);
  });

  it("does not mutate its input", () => {
    const input = [
      finding({ id: "sugg", severity: "SUGGESTION" }),
      finding({ id: "crit", severity: "CRITICAL" }),
    ];
    sortForPreview(input);
    expect(input.map((f) => f.id)).toEqual(["sugg", "crit"]);
  });
});

describe("countBySeverity", () => {
  it("tallies the three buckets and ignores anything else", () => {
    expect(
      countBySeverity([
        finding({ id: "a", severity: "CRITICAL" }),
        finding({ id: "b", severity: "CRITICAL" }),
        finding({ id: "c", severity: "SUGGESTION" }),
        finding({ id: "d", severity: "WEIRD" as FindingRecord["severity"] }),
      ]),
    ).toEqual({ CRITICAL: 2, WARNING: 0, SUGGESTION: 1 });
  });
});

describe("lineLabel", () => {
  it("collapses a single-line range", () => {
    expect(lineLabel({ start_line: 12, end_line: 12 })).toBe("12");
    expect(lineLabel({ start_line: 45, end_line: 52 })).toBe("45-52");
  });
});

describe("anchorFor", () => {
  const viewport = { width: 1440, height: 900 };

  it("opens below the anchor when there is room", () => {
    const { top, left } = anchorFor({ top: 100, bottom: 130, left: 300 }, viewport);
    expect(top).toBe(138);
    expect(left).toBe(300);
  });

  it("flips above the anchor when the card would run off the bottom", () => {
    // A row near the bottom of a long list: opening downwards would put most of
    // the card past the fold, where it cannot be read or reached.
    const { top } = anchorFor({ top: 800, bottom: 830, left: 300 }, viewport);
    expect(top).toBe(800 - CARD_MAX_HEIGHT - 8);
  });

  it("clamps against both viewport edges", () => {
    expect(anchorFor({ top: 10, bottom: 40, left: -50 }, viewport).left).toBe(8);
    expect(anchorFor({ top: 10, bottom: 40, left: 1400 }, viewport).left).toBe(
      viewport.width - CARD_WIDTH - 8,
    );
  });

  it("never pushes the card above the viewport, even in a short window", () => {
    expect(anchorFor({ top: 20, bottom: 50, left: 10 }, { width: 800, height: 300 }).top).toBe(8);
  });
});

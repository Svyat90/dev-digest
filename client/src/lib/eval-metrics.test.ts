import { describe, it, expect } from "vitest";
import { formatPercent, deltaPoints, signedNumber, signedUsd } from "./eval-metrics";

describe("eval-metrics", () => {
  it("formats percents with an em dash for unknown", () => {
    expect(formatPercent(0.825)).toBe("83%");
    expect(formatPercent(null)).toBe("—");
  });
  it("computes whole-point deltas", () => {
    expect(deltaPoints(0.82, 0.78)).toBe(4);
    expect(deltaPoints(0.82, null)).toBeNull();
    expect(deltaPoints(null, 0.5)).toBeNull();
  });
  it("signs numbers and usd", () => {
    expect(signedNumber(-2)).toBe("−2");
    expect(signedNumber(3)).toBe("+3");
    expect(signedNumber(0)).toBe("0");
    expect(signedUsd(0.01)).toBe("+$0.01");
    expect(signedUsd(-0.01)).toBe("−$0.01");
    expect(signedUsd(0)).toBe("$0");
  });
});

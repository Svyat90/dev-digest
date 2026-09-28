import { describe, expect, it } from "vitest";
import { formatSize, formatSizeDelta } from "./format-size";

describe("formatSize", () => {
  it("renders a byte count in human-readable units", () => {
    expect(formatSize(1337)).toBe("1.34 kB");
  });
});

describe("formatSizeDelta", () => {
  it("renders a growing file with a plus sign", () => {
    expect(formatSizeDelta(1000, 2200)).toBe("+1.2 kB");
  });
});

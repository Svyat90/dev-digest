import { describe, it, expect } from "vitest";
import { parseSeverityParam, parseDiffTarget } from "./helpers";

describe("parseDiffTarget", () => {
  it("reads a file and a positive integer line", () => {
    expect(parseDiffTarget("src/a.ts", "12")).toEqual({ path: "src/a.ts", line: 12 });
  });

  it("degrades a bad line to no line", () => {
    for (const bad of ["0", "-3", "1.5", "abc"]) {
      expect(parseDiffTarget("src/a.ts", bad)).toEqual({ path: "src/a.ts", line: null });
    }
    expect(parseDiffTarget("src/a.ts", null)).toEqual({ path: "src/a.ts", line: null });
  });

  it("reads a missing or empty file as no target", () => {
    expect(parseDiffTarget(null, "5")).toBeNull();
    expect(parseDiffTarget("", "5")).toBeNull();
  });
});

describe("parseSeverityParam", () => {
  it("accepts a known severity", () => {
    expect(parseSeverityParam("CRITICAL")).toBe("CRITICAL");
  });

  it("reads junk, the wrong case and an absent param as NO filter", () => {
    // A stale or hand-typed link must show everything, not nothing.
    expect(parseSeverityParam("critical")).toBeNull();
    expect(parseSeverityParam("BANANA")).toBeNull();
    expect(parseSeverityParam(null)).toBeNull();
    expect(parseSeverityParam("")).toBeNull();
  });
})

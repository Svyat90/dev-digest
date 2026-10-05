import { describe, it, expect } from "vitest";
import type { ReviewRecord } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { failureMessageKey, missingLabelKeys, newestReview, refLabel } from "./helpers";

describe("PrBriefBlock helpers", () => {
  it("refLabel prints a range or a single line", () => {
    expect(refLabel({ file: "src/a.ts", start_line: 12, end_line: 18 })).toBe("src/a.ts:12-18");
    expect(refLabel({ file: "src/a.ts", start_line: 12, end_line: null })).toBe("src/a.ts:12");
  });

  it("newestReview skips summaries and returns the first review", () => {
    const list = [
      { id: "s", kind: "summary" },
      { id: "r1", kind: "review" },
      { id: "r2", kind: "review" },
    ] as ReviewRecord[];
    expect(newestReview(list)?.id).toBe("r1");
    expect(newestReview([])).toBeUndefined();
  });

  it("failureMessageKey maps by error code", () => {
    expect(failureMessageKey(new ApiError("x", 502, "invalid_model_answer"))).toBe(
      "errors.invalidAnswer",
    );
    expect(failureMessageKey(new ApiError("x", 500, "config_error"))).toBe("errors.notConfigured");
    expect(failureMessageKey(new ApiError("x", 502, "other"))).toBe("errors.providerUnavailable");
    expect(failureMessageKey(new Error("net"))).toBe("errors.providerUnavailable");
  });

  it("missingLabelKeys maps each input to its label key", () => {
    expect(missingLabelKeys(["intent_stale", "documents"])).toEqual([
      "missing.intent_stale",
      "missing.documents",
    ]);
  });
});

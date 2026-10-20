import { describe, it, expect } from "vitest";
import type { EvalCaseDetail } from "@devdigest/shared";
import { draftFromDetail, emptyDraft, isDirty, runCaseBlocker } from "./draft";

const base = { isNew: false, dirty: false, checkRunning: false, rateLimitedUntil: null, nowMs: 1_000, runBlocker: null } as const;

describe("runCaseBlocker", () => {
  it("names the first reason in order: unsaved, running, rate limited, no agent", () => {
    expect(runCaseBlocker({ ...base, isNew: true, checkRunning: true, runBlocker: "noAgent" })).toBe("unsaved");
    expect(runCaseBlocker({ ...base, dirty: true, checkRunning: true })).toBe("unsaved");
    expect(runCaseBlocker({ ...base, checkRunning: true, rateLimitedUntil: 5_000 })).toBe("running");
    expect(runCaseBlocker({ ...base, rateLimitedUntil: 5_000, runBlocker: "noAgent" })).toBe("rateLimited");
    expect(runCaseBlocker({ ...base, runBlocker: "noAgent" })).toBe("noAgent");
    expect(runCaseBlocker(base)).toBeNull();
  });

  it("lets a run start once the rate limit has passed", () => {
    expect(runCaseBlocker({ ...base, rateLimitedUntil: 900 })).toBeNull();
  });
});

describe("draft", () => {
  it("starts empty with must_find and an empty expected output", () => {
    expect(emptyDraft()).toMatchObject({ name: "", input_diff: "", expectation_type: "must_find", expected_output_json: "[]" });
  });

  it("is not dirty right after it is built from a detail", () => {
    const detail = {
      name: "leak",
      input_diff: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b",
      input_meta: { pr_title: "t", pr_description: "d" },
      expectation_type: "must_find",
      expectation: { file: "x", start_line: 1, end_line: 1 },
      expected_output: [{ severity: "WARNING", category: "bug", title: "b", file: "x", start_line: 1, end_line: 1 }],
    } as unknown as EvalCaseDetail;
    const draft = draftFromDetail(detail);
    expect(draft.expected_output_json).toContain('\n  {\n    "severity": "WARNING"');
    expect(isDirty(draft, draftFromDetail(detail))).toBe(false);
    expect(isDirty({ ...draft, name: "other" }, draftFromDetail(detail))).toBe(true);
    expect(isDirty(draft, null)).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import type { EvalCaseIssue } from "@devdigest/shared";
import { firstIssue, issueMessageKey, issueValues } from "./helpers";

const stray: EvalCaseIssue = { field: "input_diff", code: "diff_stray_line", line: 7, key: null };

describe("case-editor helpers", () => {
  it("maps an issue to its message key and values", () => {
    expect(issueMessageKey(stray)).toBe("caseEditor.issues.input_diff.diff_stray_line");
    expect(issueValues(stray)).toMatchObject({ line: 7, limit: 100_000 });
  });

  it("picks the first issue of the asked field only", () => {
    const title: EvalCaseIssue = { field: "pr_title", code: "too_long", line: null, key: null };
    expect(firstIssue([stray, title], "pr_title")).toBe(title);
    expect(firstIssue([stray], "expected_output")).toBeNull();
    expect(issueValues(title)).toEqual({ limit: 300 });
  });
});

import {
  EVAL_CASE_LIMITS,
  type CaseDiffFile,
  type CaseDiffLine,
  type EvalCaseIssue,
  type EvalCaseIssueField,
} from "@devdigest/shared";

/** Message key of an issue, relative to the `eval` namespace. */
export function issueMessageKey(issue: EvalCaseIssue): string {
  return `caseEditor.issues.${issue.field}.${issue.code}`;
}

/** The limit a field's issue message names, when it has one. */
function issueLimit(issue: EvalCaseIssue): number | null {
  switch (issue.field) {
    case "name":
      return EVAL_CASE_LIMITS.nameChars;
    case "input_diff":
      return EVAL_CASE_LIMITS.diffChars;
    case "pr_title":
      return EVAL_CASE_LIMITS.prTitleChars;
    case "pr_description":
      return EVAL_CASE_LIMITS.prDescriptionChars;
    case "expected_output":
      return issue.code === "json_bad_title" ? EVAL_CASE_LIMITS.findingTitleChars : EVAL_CASE_LIMITS.expectedOutputChars;
    default:
      return null;
  }
}

/** ICU values of an issue message: `line`, `limit` and `key`, each only when known. */
export function issueValues(issue: EvalCaseIssue): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  if (issue.line !== null) values.line = issue.line;
  const limit = issueLimit(issue);
  if (limit !== null) values.limit = limit;
  if (issue.key !== null) values.key = issue.key;
  return values;
}

/** The first issue of one field, or null. */
export function firstIssue(issues: readonly EvalCaseIssue[], field: EvalCaseIssueField): EvalCaseIssue | null {
  return issues.find((i) => i.field === field) ?? null;
}

/** Option label of a parsed file in the expectation's file select. */
export function fileLabel(file: CaseDiffFile): string {
  return file.path;
}

/** The marker a preview row shows as text next to its colour; null for headers. */
export function lineMarker(kind: CaseDiffLine["kind"]): string | null {
  if (kind === "add") return "+";
  if (kind === "del") return "−";
  if (kind === "context") return " ";
  return null;
}

/** A body line without its leading marker character. */
export function lineBody(line: CaseDiffLine): string {
  return lineMarker(line.kind) === null ? line.text : line.text.slice(1);
}

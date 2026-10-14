import { EvalCaseIssue, type EvalCaseDetail, type EvalCaseDraft } from "@devdigest/shared";
import { ApiError } from "@/lib/api";

export type RunCaseBlocker = "unsaved" | "running" | "rateLimited" | "noAgent";

const KNOWN_REFUSALS = [
  "eval_case_content_fixed",
  "eval_case_edit_conflict",
  "eval_case_check_in_progress",
  "eval_agent_required",
  "eval_agent_missing",
  "run_start_rate_limited",
] as const;

/** The issues of a 422 `eval_case_invalid` (a server-side `name_taken` included); else null. */
export function serverIssuesOf(err: unknown): EvalCaseIssue[] | null {
  if (!(err instanceof ApiError) || err.code !== "eval_case_invalid") return null;
  const parsed = EvalCaseIssue.array().safeParse((err.details as { issues?: unknown } | undefined)?.issues);
  return parsed.success && parsed.data.length > 0 ? parsed.data : null;
}

/** The `caseEditor.errors.*` key of a refusal: its code when known, else `generic`. */
export function refusalKey(err: unknown): string {
  const code = err instanceof ApiError ? err.code : undefined;
  return (KNOWN_REFUSALS as readonly (string | undefined)[]).includes(code) ? (code as string) : "generic";
}

/** A new case's draft: nothing typed yet, `must_find`, expected output `[]`. */
export function emptyDraft(): EvalCaseDraft {
  return {
    name: "",
    input_diff: "",
    pr_title: "",
    pr_description: "",
    expectation_type: "must_find",
    expectation: { file: "", start_line: 1, end_line: 1 },
    expected_output_json: "[]",
  };
}

/** The draft of a saved case; the expected output is pretty-printed JSON. */
export function draftFromDetail(detail: EvalCaseDetail): EvalCaseDraft {
  return {
    name: detail.name,
    input_diff: detail.input_diff,
    pr_title: detail.input_meta.pr_title,
    pr_description: detail.input_meta.pr_description,
    expectation_type: detail.expectation_type,
    expectation: {
      file: detail.expectation.file,
      start_line: detail.expectation.start_line,
      end_line: detail.expectation.end_line,
    },
    expected_output_json: JSON.stringify(detail.expected_output, null, 2),
  };
}

/** Whether the draft differs from the last saved draft; never saved → dirty. */
export function isDirty(draft: EvalCaseDraft, saved: EvalCaseDraft | null): boolean {
  if (saved === null) return true;
  return (
    draft.name !== saved.name ||
    draft.input_diff !== saved.input_diff ||
    draft.pr_title !== saved.pr_title ||
    draft.pr_description !== saved.pr_description ||
    draft.expectation_type !== saved.expectation_type ||
    draft.expectation.file !== saved.expectation.file ||
    draft.expectation.start_line !== saved.expectation.start_line ||
    draft.expectation.end_line !== saved.expectation.end_line ||
    draft.expected_output_json !== saved.expected_output_json
  );
}

/** Why Run case is disabled (SPEC-06 AC16), first reason wins; null = it may run. */
export function runCaseBlocker(input: {
  isNew: boolean;
  dirty: boolean;
  checkRunning: boolean;
  rateLimitedUntil: number | null;
  nowMs: number;
  runBlocker: "noAgent" | null;
}): RunCaseBlocker | null {
  if (input.isNew || input.dirty) return "unsaved";
  if (input.checkRunning) return "running";
  if (input.rateLimitedUntil !== null && input.nowMs < input.rateLimitedUntil) return "rateLimited";
  return input.runBlocker;
}

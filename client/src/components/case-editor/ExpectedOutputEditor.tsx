"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import { findingSkeleton, type EvalCaseDraft, type EvalCaseIssue, type EvalExpectationType } from "@devdigest/shared";
import { issueMessageKey, issueValues } from "./helpers";
import { s } from "./styles";

interface ExpectedOutputEditorProps {
  value: string;
  expectationType: EvalExpectationType;
  expectation: EvalCaseDraft["expectation"];
  issue: EvalCaseIssue | null;
  readOnly: boolean;
  onChange: (value: string) => void;
}

/**
 * The expected-output JSON (SPEC-06 AC6, AC7): a monospace textarea, a badge
 * with icon and text, the first issue's reason, and "+ Finding skeleton".
 */
export function ExpectedOutputEditor({ value, expectationType, expectation, issue, readOnly, onChange }: ExpectedOutputEditorProps) {
  const t = useTranslations("eval");
  const id = useId();
  const statusId = `${id}-status`;
  const hintId = `${id}-hint`;
  const mustNotFlag = expectationType === "must_not_flag";
  const invalid = issue !== null;

  return (
    <div style={s.section}>
      <div style={s.toolbar}>
        <label htmlFor={id} style={s.label}>
          {t("caseEditor.expectedOutput")}
        </label>
        <Badge
          icon={invalid ? "XCircle" : "CheckCircle"}
          color={invalid ? "var(--crit)" : "var(--ok)"}
          bg={invalid ? "var(--crit-bg)" : "var(--ok-bg)"}
        >
          {t(invalid ? "caseEditor.invalidJson" : "caseEditor.validJson")}
        </Badge>
        <Button
          size="sm"
          kind="ghost"
          disabled={readOnly || mustNotFlag}
          aria-describedby={mustNotFlag ? hintId : undefined}
          onClick={() => onChange(findingSkeleton(expectation))}
          style={{ marginLeft: "auto" }}
        >
          {t("caseEditor.findingSkeleton")}
        </Button>
      </div>
      {mustNotFlag && (
        <span id={hintId} style={s.hint}>
          {t("caseEditor.skeletonDisabledHint")}
        </span>
      )}
      <textarea
        id={id}
        value={value}
        rows={8}
        readOnly={readOnly}
        disabled={readOnly}
        spellCheck={false}
        aria-invalid={invalid}
        aria-describedby={statusId}
        onChange={(e) => onChange(e.target.value)}
        style={s.code(invalid)}
      />
      <div id={statusId} style={s.issue}>
        {issue !== null && t(issueMessageKey(issue), issueValues(issue))}
      </div>
    </div>
  );
}

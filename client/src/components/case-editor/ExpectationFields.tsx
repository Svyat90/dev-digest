"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import type { CaseDiffFile, EvalCaseDraft, EvalCaseIssue, EvalExpectationType } from "@devdigest/shared";
import { fileLabel, firstIssue, issueMessageKey, issueValues } from "./helpers";
import { s } from "./styles";

type ExpectationPatch = Partial<Pick<EvalCaseDraft, "expectation_type" | "expectation">>;

interface ExpectationFieldsProps {
  expectationType: EvalExpectationType;
  expectation: EvalCaseDraft["expectation"];
  files: readonly CaseDiffFile[];
  issues: readonly EvalCaseIssue[];
  readOnly: boolean;
  onChange: (patch: ExpectationPatch) => void;
}

const TYPES: readonly EvalExpectationType[] = ["must_find", "must_not_flag"];

/** Expectation type, file and line range of a case. Renders props only. */
export function ExpectationFields({ expectationType, expectation, files, issues, readOnly, onChange }: ExpectationFieldsProps) {
  const t = useTranslations("eval");
  const id = useId();
  const issueId = `${id}-issue`;
  const issue = firstIssue(issues, "expectation");
  const described = issue !== null ? issueId : undefined;
  // A stored file the current diff no longer has still shows as the selected value.
  const knownFile = expectation.file === "" || files.some((f) => f.path === expectation.file);
  const setLine = (key: "start_line" | "end_line", raw: number) =>
    onChange({ expectation: { ...expectation, [key]: Number.isFinite(raw) ? Math.trunc(raw) : 0 } });

  return (
    <fieldset style={s.fieldset} disabled={readOnly}>
      <legend style={s.label}>{t("caseEditor.expectationLabel")}</legend>
      <div style={s.row} role="radiogroup" aria-label={t("caseEditor.expectationLabel")}>
        {TYPES.map((type) => {
          const name = t(`evalsTab.expectation.${type}`);
          return (
            <label key={type} style={s.radio}>
              <input
                type="radio"
                name={`${id}-type`}
                value={type}
                aria-label={name}
                checked={expectationType === type}
                onChange={() => onChange({ expectation_type: type })}
              />
              {name}
            </label>
          );
        })}
      </div>

      <div style={s.row}>
        <div style={s.column}>
          <label htmlFor={`${id}-file`} style={s.label}>
            {t("caseEditor.fileLabel")}
          </label>
          <select
            id={`${id}-file`}
            aria-label={t("caseEditor.fileLabel")}
            aria-invalid={issue !== null}
            aria-describedby={described}
            value={expectation.file}
            onChange={(e) => onChange({ expectation: { ...expectation, file: e.target.value } })}
            style={s.field(issue !== null)}
          >
            <option value="">{t("caseEditor.filePlaceholder")}</option>
            {!knownFile && <option value={expectation.file}>{expectation.file}</option>}
            {files.map((file) => (
              <option key={file.path} value={file.path}>
                {fileLabel(file)}
              </option>
            ))}
          </select>
        </div>
        <div style={s.column}>
          <label htmlFor={`${id}-start`} style={s.label}>
            {t("caseEditor.startLineLabel")}
          </label>
          <input
            id={`${id}-start`}
            type="number"
            min={1}
            aria-label={t("caseEditor.startLineLabel")}
            aria-invalid={issue !== null}
            aria-describedby={described}
            value={expectation.start_line}
            onChange={(e) => setLine("start_line", e.target.valueAsNumber)}
            style={{ ...s.field(issue !== null), ...s.number }}
          />
        </div>
        <div style={s.column}>
          <label htmlFor={`${id}-end`} style={s.label}>
            {t("caseEditor.endLineLabel")}
          </label>
          <input
            id={`${id}-end`}
            type="number"
            min={1}
            aria-label={t("caseEditor.endLineLabel")}
            aria-invalid={issue !== null}
            aria-describedby={described}
            value={expectation.end_line}
            onChange={(e) => setLine("end_line", e.target.valueAsNumber)}
            style={{ ...s.field(issue !== null), ...s.number }}
          />
        </div>
      </div>

      {issue !== null && (
        <div id={issueId} role="alert" style={s.issue}>
          {t(issueMessageKey(issue), issueValues(issue))}
        </div>
      )}
    </fieldset>
  );
}

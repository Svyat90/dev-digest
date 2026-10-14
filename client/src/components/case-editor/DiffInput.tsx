"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import {
  EVAL_CASE_LIMITS,
  type CaseDiffParse,
  type EvalCaseDraft,
  type EvalCaseIssue,
  type EvalCaseIssueField,
} from "@devdigest/shared";
import { DiffPreview } from "./DiffPreview";
import { firstIssue, issueMessageKey, issueValues } from "./helpers";
import { s } from "./styles";

type DiffPatch = Partial<Pick<EvalCaseDraft, "input_diff" | "pr_title" | "pr_description">>;
type InputTab = "diff" | "files" | "prMeta";

interface DiffInputProps {
  diff: string;
  prTitle: string;
  prDescription: string;
  parse: CaseDiffParse;
  issues: readonly EvalCaseIssue[];
  readOnly: boolean;
  onChange: (patch: DiffPatch) => void;
}

/** The case input: Diff (with preview), Files and PR meta tabs. Renders props only. */
export function DiffInput({ diff, prTitle, prDescription, parse, issues, readOnly, onChange }: DiffInputProps) {
  const t = useTranslations("eval");
  const [tab, setTab] = useState<InputTab>("diff");
  const diffIssueId = useId();
  const diffIssue = firstIssue(issues, "input_diff");

  return (
    <div style={s.section}>
      <Tabs
        pad="0"
        value={tab}
        onChange={(k) => setTab(k as InputTab)}
        tabs={[
          { key: "diff", label: t("caseEditor.tabs.diff") },
          { key: "files", label: t("caseEditor.tabs.files") },
          { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
        ]}
      />

      {tab === "diff" && (
        <>
          <textarea
            aria-label={t("caseEditor.tabs.diff")}
            aria-invalid={diffIssue !== null}
            aria-describedby={diffIssue !== null ? diffIssueId : undefined}
            value={diff}
            rows={10}
            placeholder={t("caseEditor.diffPlaceholder")}
            readOnly={readOnly}
            disabled={readOnly}
            spellCheck={false}
            onChange={(e) => onChange({ input_diff: e.target.value })}
            style={s.code(diffIssue !== null)}
          />
          {diffIssue !== null && (
            <div id={diffIssueId} role="alert" style={s.issue}>
              {t(issueMessageKey(diffIssue), issueValues(diffIssue))}
            </div>
          )}
          <span style={s.label}>{t("caseEditor.preview")}</span>
          <DiffPreview parse={parse} />
        </>
      )}

      {tab === "files" &&
        (parse.files.length === 0 ? (
          <div style={s.empty}>{t("caseEditor.filesEmpty")}</div>
        ) : (
          <ul style={s.fileList}>
            {parse.files.map((file) => (
              <li key={file.path} style={s.fileRow}>
                <span>{file.path}</span>
                <span style={s.fileStats}>
                  {t("caseEditor.fileStats", { added: file.additions, removed: file.deletions })}
                </span>
              </li>
            ))}
          </ul>
        ))}

      {tab === "prMeta" && (
        <>
          <CountedField
            field="pr_title"
            label={t("caseEditor.titleLabel")}
            placeholder={t("caseEditor.titlePlaceholder")}
            value={prTitle}
            limit={EVAL_CASE_LIMITS.prTitleChars}
            issues={issues}
            readOnly={readOnly}
            onChange={(v) => onChange({ pr_title: v })}
          />
          <CountedField
            field="pr_description"
            multiline
            label={t("caseEditor.bodyLabel")}
            placeholder={t("caseEditor.bodyPlaceholder")}
            value={prDescription}
            limit={EVAL_CASE_LIMITS.prDescriptionChars}
            issues={issues}
            readOnly={readOnly}
            onChange={(v) => onChange({ pr_description: v })}
          />
        </>
      )}
    </div>
  );
}

interface CountedFieldProps {
  field: EvalCaseIssueField;
  label: string;
  placeholder: string;
  value: string;
  limit: number;
  issues: readonly EvalCaseIssue[];
  readOnly: boolean;
  multiline?: boolean;
  onChange: (value: string) => void;
}

/** A labelled text field with a visible `{count} / {limit}` counter (SPEC-06 AC4). */
function CountedField({ field, label, placeholder, value, limit, issues, readOnly, multiline, onChange }: CountedFieldProps) {
  const t = useTranslations("eval");
  const id = useId();
  const metaId = `${id}-meta`;
  const issue = firstIssue(issues, field);
  const over = value.length > limit;
  const invalid = issue !== null || over;
  const shared = {
    id,
    value,
    placeholder,
    readOnly,
    disabled: readOnly,
    "aria-invalid": invalid,
    "aria-describedby": metaId,
  };

  return (
    <div style={s.column}>
      <label htmlFor={id} style={s.label}>
        {label}
      </label>
      {multiline ? (
        <textarea {...shared} rows={4} onChange={(e) => onChange(e.target.value)} style={s.code(invalid)} />
      ) : (
        <input {...shared} type="text" onChange={(e) => onChange(e.target.value)} style={s.field(invalid)} />
      )}
      <div id={metaId} style={s.meta}>
        {issue !== null && <span style={s.issue}>{t(issueMessageKey(issue), issueValues(issue))}</span>}
        <span style={s.counter(over)}>{t("caseEditor.counter", { count: value.length, limit })}</span>
      </div>
    </div>
  );
}

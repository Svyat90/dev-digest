import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { AgentEvalCaseListItem } from "@devdigest/shared";
import { s } from "./styles";

function ResultCell({ item }: { item: AgentEvalCaseListItem }) {
  const t = useTranslations("eval");
  const r = item.latest_result;
  // State is conveyed by icon + text, never colour alone.
  if (!r) {
    return (
      <span style={s.result}>
        <Icon.Clock size={14} aria-hidden />
        {t("evalsTab.neverRun")}
      </span>
    );
  }
  if (r.status === "errored") {
    return (
      <span style={s.result}>
        <Icon.AlertTriangle size={14} aria-hidden />
        {r.error ? t("evalsTab.result.errorReason", { reason: r.error }) : t("evalsTab.result.errored")}
      </span>
    );
  }
  const Glyph = r.status === "passed" ? Icon.CheckCircle : Icon.XCircle;
  return (
    <span style={s.result}>
      <Glyph size={14} aria-hidden />
      <span>{t(`evalsTab.${r.status}`)}</span>
      <span style={s.caseSub}>{t("evalsTab.result.expected", { expected: r.expected, got: r.got ?? 0 })}</span>
    </span>
  );
}

/** The agent's eval cases: expectation, location and latest result per case. */
export function CaseList({
  cases,
  onDelete,
  deleting,
}: {
  cases: AgentEvalCaseListItem[];
  onDelete: (item: AgentEvalCaseListItem) => void;
  deleting: boolean;
}) {
  const t = useTranslations("eval");
  return (
    <ul style={s.list}>
      {cases.map((c) => (
        <li key={c.id} style={s.caseRow}>
          <div style={s.caseMain}>
            <div style={s.caseName}>{c.name}</div>
            <div style={s.caseSub}>
              {t(`evalsTab.expectation.${c.expectation_type}`)} · {c.expectation.file}:{c.expectation.start_line}–
              {c.expectation.end_line}
            </div>
          </div>
          <ResultCell item={c} />
          <button
            type="button"
            style={s.deleteBtn}
            disabled={deleting}
            aria-label={t("evalsTab.deleteCase", { name: c.name })}
            onClick={() => onDelete(c)}
          >
            <Icon.Trash size={14} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

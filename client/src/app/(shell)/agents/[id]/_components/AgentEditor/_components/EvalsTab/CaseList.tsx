import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { AgentEvalCaseListItem } from "@devdigest/shared";
import { evalUi } from "@/components/eval-ui";
import { s } from "./styles";

/** Status glyph + the one-line outcome. State is icon + text, never colour alone. */
function outcomeOf(
  item: AgentEvalCaseListItem,
  t: ReturnType<typeof useTranslations>,
): { glyph: ReactNode; text: string } {
  const r = item.latest_result;
  if (!r) {
    return {
      glyph: <Icon.Dot size={16} aria-hidden style={{ color: "var(--text-muted)" }} />,
      text: t("evalsTab.neverRun"),
    };
  }
  if (r.status === "errored") {
    return {
      glyph: <Icon.AlertTriangle size={16} aria-hidden style={{ color: "var(--warn)" }} />,
      text: r.error ? t("evalsTab.result.errorReason", { reason: r.error }) : t("evalsTab.result.errored"),
    };
  }
  return {
    glyph:
      r.status === "passed" ? (
        <Icon.CheckCircle size={16} aria-hidden style={{ color: "var(--ok)" }} />
      ) : (
        <Icon.XCircle size={16} aria-hidden style={{ color: "var(--crit)" }} />
      ),
    text: t("evalsTab.result.expected", { expected: r.expected, got: r.got ?? 0 }),
  };
}

/** The agent's eval cases: outcome, expectation chip and delete per case. */
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
      {cases.map((c) => {
        const o = outcomeOf(c, t);
        const mustFind = c.expectation_type === "must_find";
        const where = `${c.expectation.file}:${c.expectation.start_line}–${c.expectation.end_line}`;
        return (
          <li key={c.id} style={s.caseRow}>
            <span style={s.glyph}>{o.glyph}</span>
            <div style={s.caseMain}>
              <div style={s.caseName}>{c.name}</div>
              <div style={s.caseSub}>{o.text}</div>
            </div>
            <span style={evalUi.chip} title={`${t(`evalsTab.expectation.${c.expectation_type}`)} · ${where}`}>
              {mustFind
                ? `${c.provenance.severity.toUpperCase()} · ${c.provenance.category}`
                : t("evalsTab.expectation.empty")}
            </span>
            <button
              type="button"
              style={s.deleteBtn}
              disabled={deleting}
              aria-label={t("evalsTab.deleteCase", { name: c.name })}
              onClick={() => onDelete(c)}
            >
              <Icon.Trash size={15} aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

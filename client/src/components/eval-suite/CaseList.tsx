import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalCaseListItem } from "@devdigest/shared";
import { evalUi } from "@/components/eval-ui";
import { LastRunLine } from "./LastRunLine";
import { caseRowState, checkToLastRun } from "./helpers";
import { s } from "./styles";

/** Status glyph + the one-line outcome. State is icon + text, never colour alone. */
function outcomeOf(
  item: EvalCaseListItem,
  t: ReturnType<typeof useTranslations>,
): { glyph: ReactNode; text: string } {
  const state = caseRowState(item);
  const r = item.latest_result;
  if (state === "never" || !r) {
    return {
      glyph: <Icon.Dot size={16} aria-hidden style={{ color: "var(--text-muted)" }} />,
      text: t("evalsTab.neverRun"),
    };
  }
  if (state === "edited") {
    return {
      glyph: <Icon.Edit size={16} aria-hidden style={{ color: "var(--text-muted)" }} />,
      text: t("evalsTab.editedSinceLastRun"),
    };
  }
  if (state === "errored") {
    return {
      glyph: <Icon.AlertTriangle size={16} aria-hidden style={{ color: "var(--warn)" }} />,
      text: r.error ? t("evalsTab.result.errorReason", { reason: r.error }) : t("evalsTab.result.errored"),
    };
  }
  return {
    glyph:
      state === "passed" ? (
        <Icon.CheckCircle size={16} aria-hidden style={{ color: "var(--ok)" }} />
      ) : (
        <Icon.XCircle size={16} aria-hidden style={{ color: "var(--crit)" }} />
      ),
    text: t("evalsTab.result.expected", { expected: r.expected, got: r.got ?? 0 }),
  };
}

/**
 * Eval cases of one set (an agent's or a skill's): outcome, expectation chip,
 * the newest single-case result, and edit / run / delete per case. An action
 * whose callback is absent is not rendered.
 */
export function CaseList({
  cases,
  onDelete,
  onEdit,
  onRun,
  runDisabledReason,
  deleting = false,
}: {
  cases: readonly EvalCaseListItem[];
  onDelete: (item: EvalCaseListItem) => void;
  onEdit?: (item: EvalCaseListItem, trigger: HTMLElement) => void;
  onRun?: (item: EvalCaseListItem) => void;
  runDisabledReason?: (item: EvalCaseListItem) => string | null;
  /** A delete is pending: every row's delete button is disabled. */
  deleting?: boolean;
}) {
  const t = useTranslations("eval");
  const idBase = useId();
  return (
    <ul style={s.list}>
      {cases.map((c) => {
        const o = outcomeOf(c, t);
        const where = `${c.expectation.file}:${c.expectation.start_line}–${c.expectation.end_line}`;
        const chip =
          c.expectation_type === "must_find"
            ? c.provenance
              ? `${c.provenance.severity.toUpperCase()} · ${c.provenance.category}`
              : t("evalsTab.expectation.must_find")
            : t("evalsTab.expectation.empty");
        const runReason = onRun ? (runDisabledReason?.(c) ?? null) : null;
        const reasonId = `${idBase}-${c.id}-run-reason`;
        return (
          <li key={c.id} style={s.caseRow}>
            <span style={s.glyph}>{o.glyph}</span>
            <div style={s.caseMain}>
              <div style={s.caseName}>{c.name}</div>
              <div style={s.caseSub}>{o.text}</div>
              {c.check ? (
                <LastRunLine lastRun={checkToLastRun(c.check)} running={c.check.status === "running"} />
              ) : null}
            </div>
            <span style={evalUi.chip} title={`${t(`evalsTab.expectation.${c.expectation_type}`)} · ${where}`}>
              {chip}
            </span>
            {onEdit ? (
              <button
                type="button"
                style={s.iconBtn}
                aria-label={`${t("evalsTab.edit")} ${c.name}`}
                onClick={(event) => onEdit(c, event.currentTarget)}
              >
                <Icon.Edit size={15} aria-hidden />
              </button>
            ) : null}
            {onRun ? (
              <>
                {runReason ? (
                  <span id={reasonId} style={s.runReason}>
                    {runReason}
                  </span>
                ) : null}
                <button
                  type="button"
                  style={s.iconBtn}
                  disabled={runReason !== null}
                  aria-label={`${t("evalsTab.run")} ${c.name}`}
                  aria-describedby={runReason ? reasonId : undefined}
                  onClick={() => onRun(c)}
                >
                  <Icon.Play size={15} aria-hidden />
                </button>
              </>
            ) : null}
            <button
              type="button"
              style={s.iconBtn}
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

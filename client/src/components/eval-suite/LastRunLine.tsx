import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalCaseLastRun } from "@devdigest/shared";
import { formatUsd } from "@/lib/format";
import { s } from "./styles";

function glyphOf(status: EvalCaseLastRun["status"]): ReactNode {
  if (status === "passed") return <Icon.CheckCircle size={14} aria-hidden style={{ color: "var(--ok)" }} />;
  if (status === "failed") return <Icon.XCircle size={14} aria-hidden style={{ color: "var(--crit)" }} />;
  return <Icon.AlertTriangle size={14} aria-hidden style={{ color: "var(--warn)" }} />;
}

/**
 * One single-case result (SPEC-06 AC14): status, expected vs got (the reason
 * when errored), duration and cost. Icon + text, never colour alone.
 */
export function LastRunLine({ lastRun, running }: { lastRun: EvalCaseLastRun | null; running: boolean }) {
  const t = useTranslations("eval");
  if (running) {
    return (
      <div style={s.lastRun} aria-live="polite">
        <Icon.Clock size={14} aria-hidden />
        <span>{t("caseEditor.lastRun.running")}</span>
      </div>
    );
  }
  if (!lastRun) {
    return (
      <div style={s.lastRun}>
        <Icon.Dot size={14} aria-hidden />
        <span>{t("caseEditor.lastRun.never")}</span>
      </div>
    );
  }
  const parts = [
    t(`caseEditor.lastRun.${lastRun.status}`),
    lastRun.status === "errored"
      ? (lastRun.error ?? t("evalsTab.result.errored"))
      : t("caseEditor.lastRun.expectedGot", { expected: lastRun.expected, got: lastRun.got ?? 0 }),
  ];
  if (lastRun.duration_ms != null) {
    parts.push(t("caseEditor.lastRun.duration", { seconds: Math.round(lastRun.duration_ms / 100) / 10 }));
  }
  parts.push(formatUsd(lastRun.cost_usd));
  return (
    <div style={s.lastRun} aria-live="polite">
      {glyphOf(lastRun.status)}
      <span>{parts.join(" · ")}</span>
    </div>
  );
}

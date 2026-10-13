import { useTranslations } from "next-intl";
import type { AgentEvalRunSummary } from "@devdigest/shared";
import { formatUsd } from "@/lib/format";
import { formatPercent, formatStarted } from "./helpers";
import { s } from "./styles";

/** Eval runs of the agent, newest first. */
export function RunHistory({ runs }: { runs: AgentEvalRunSummary[] }) {
  const t = useTranslations("eval");
  return (
    <table style={s.table} aria-label={t("evalsTab.history.title")}>
      <thead>
        <tr>
          <th style={s.th}>{t("evalsTab.history.started")}</th>
          <th style={s.th}>{t("evalsTab.history.version")}</th>
          <th style={s.th}>{t("dashboard.table.recall")}</th>
          <th style={s.th}>{t("dashboard.table.precision")}</th>
          <th style={s.th}>{t("dashboard.table.citation")}</th>
          <th style={s.th}>{t("evalsTab.history.passed")}</th>
          <th style={s.th}>{t("evalsTab.history.cost")}</th>
          <th style={s.th}>{t("evalsTab.history.status")}</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id}>
            <td style={s.td}>{formatStarted(r.started_at)}</td>
            <td style={s.td}>{`v${r.agent_version}`}</td>
            <td style={s.td}>{formatPercent(r.recall)}</td>
            <td style={s.td}>{formatPercent(r.precision)}</td>
            <td style={s.td}>{formatPercent(r.citation_accuracy)}</td>
            <td style={s.td}>{`${r.cases_passed} / ${r.cases_total}`}</td>
            <td style={s.td}>{formatUsd(r.cost_usd)}</td>
            <td style={s.td}>{t(`evalsTab.history.statusValue.${r.status}`)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { EvalTrendPoint } from "@/vendor/shared";
import { formatPercent } from "@/lib/eval-metrics";
import { formatUsd } from "@/lib/format";
import { s } from "./styles";

/** Tooltip body for one trend point: start time, version, metrics and cost. */
export function TrendTooltip({ point }: { point: EvalTrendPoint }) {
  const t = useTranslations("eval");
  const format = useFormatter();
  return (
    <div style={s.tooltip}>
      <span style={s.tooltipTime}>
        {format.dateTime(new Date(point.started_at), { dateStyle: "medium", timeStyle: "short" })}
      </span>
      <strong>{t("agentDashboard.tooltipVersion", { version: point.agent_version })}</strong>
      <div style={s.tooltipRow}>
        <span>{t("dashboard.legend.recall")}</span>
        <span>{formatPercent(point.recall)}</span>
      </div>
      <div style={s.tooltipRow}>
        <span>{t("dashboard.legend.precision")}</span>
        <span>{formatPercent(point.precision)}</span>
      </div>
      <div style={s.tooltipRow}>
        <span>{t("dashboard.legend.citation")}</span>
        <span>{formatPercent(point.citation_accuracy)}</span>
      </div>
      <span>{t("agentDashboard.tooltipCost", { cost: formatUsd(point.cost_usd) })}</span>
    </div>
  );
}

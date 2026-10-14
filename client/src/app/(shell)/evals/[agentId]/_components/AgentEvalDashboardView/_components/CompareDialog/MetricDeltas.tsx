import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalComparedRun } from "@devdigest/shared";
import { NO_DATA, formatUsd } from "@/lib/format";
import { deltaPoints, formatPercent, signedNumber, signedUsd } from "@/lib/eval-metrics";
import { s } from "./styles";

type Metric = "recall" | "precision" | "citation_accuracy";
const METRICS: { key: Metric; label: "recall" | "precision" | "citation" }[] = [
  { key: "recall", label: "recall" },
  { key: "precision", label: "precision" },
  { key: "citation_accuracy", label: "citation" },
];

function Arrow({ points }: { points: number | null }) {
  if (points == null || points === 0) return null;
  return points > 0 ? <Icon.ArrowUp size={12} aria-hidden /> : <Icon.ArrowDown size={12} aria-hidden />;
}

/** Earlier → later per metric with a signed change (sign + arrow, not colour alone). */
export function MetricDeltas({ earlier, later }: { earlier: EvalComparedRun; later: EvalComparedRun }) {
  const t = useTranslations("eval");
  const costKnown = earlier.cost_usd != null && later.cost_usd != null;
  const costDiff = costKnown ? (later.cost_usd as number) - (earlier.cost_usd as number) : null;
  return (
    <div style={s.section}>
      {METRICS.map(({ key, label }) => {
        const points = deltaPoints(later[key], earlier[key]);
        return (
          <div key={key} style={s.metricRow}>
            <span style={s.metricName}>{t(`dashboard.metrics.${label === "citation" ? "citationAccuracy" : label}`)}</span>
            <span>
              {t("compare.oldNew", { old: formatPercent(earlier[key]), new: formatPercent(later[key]) })}
            </span>
            {points != null && (
              <span style={s.delta}>
                <Arrow points={points} />
                {t("agentDashboard.deltaPoints", { value: signedNumber(points) })}
              </span>
            )}
          </div>
        );
      })}
      <div style={s.metricRow}>
        <span style={s.metricName}>{t("compare.cost")}</span>
        <span>
          {t("compare.oldNew", { old: formatUsd(earlier.cost_usd), new: formatUsd(later.cost_usd) })}
        </span>
        {costDiff != null ? <span style={s.delta}>{signedUsd(costDiff)}</span> : <span style={s.delta}>{NO_DATA}</span>}
      </div>
    </div>
  );
}

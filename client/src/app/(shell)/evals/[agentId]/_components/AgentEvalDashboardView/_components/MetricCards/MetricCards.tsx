import { useTranslations } from "next-intl";
import type { AgentEvalRunSummary, EvalTrendPoint } from "@devdigest/shared";
import { EVAL_METRIC_COLOR, MetricTile, evalUi, type EvalMetricKey } from "@/components/eval-ui";
import { deltaPoints, signedNumber, toPercent } from "@/lib/eval-metrics";

const CARDS: { metric: EvalMetricKey; label: "recall" | "precision" | "citationAccuracy" }[] = [
  { metric: "recall", label: "recall" },
  { metric: "precision", label: "precision" },
  { metric: "citation_accuracy", label: "citationAccuracy" },
];

/** Latest completed run's metrics with the signed point change and a range sparkline (AC10). */
export function MetricCards({
  latest,
  previous,
  trend,
}: {
  latest: AgentEvalRunSummary | null;
  previous: AgentEvalRunSummary | null;
  trend: EvalTrendPoint[];
}) {
  const t = useTranslations("eval");
  return (
    <div style={evalUi.tilesGrid}>
      {CARDS.map(({ metric, label }) => {
        const delta = latest && previous ? deltaPoints(latest[metric], previous[metric]) : null;
        const values = trend.map((p) => toPercent(p[metric])).filter((v): v is number => v != null);
        return (
          <MetricTile
            key={metric}
            label={t(`dashboard.metrics.${label}`)}
            value={latest?.[metric]}
            color={EVAL_METRIC_COLOR[metric]}
            deltaPoints={delta}
            deltaText={delta != null ? t("agentDashboard.deltaPoints", { value: signedNumber(delta) }) : null}
            trend={values}
          />
        );
      })}
    </div>
  );
}

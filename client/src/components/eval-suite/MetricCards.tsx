import { useTranslations } from "next-intl";
import { NO_DATA } from "@/lib/format";
import { EVAL_METRIC_COLOR, MetricTile, evalUi, type EvalMetricKey } from "@/components/eval-ui";
import { deltaPoints, formatDelta, type EvalSuiteRunLike } from "./helpers";

const CARDS: { metric: EvalMetricKey; label: "recall" | "precision" | "citationAccuracy" }[] = [
  { metric: "recall", label: "recall" },
  { metric: "precision", label: "precision" },
  { metric: "citation_accuracy", label: "citationAccuracy" },
];

/** Latest completed run's metrics with the point delta versus the previous one. */
export function MetricCards({
  latest,
  previous,
}: {
  latest: EvalSuiteRunLike | null;
  previous: EvalSuiteRunLike | null;
}) {
  const t = useTranslations("eval");
  return (
    <div style={evalUi.tilesGrid}>
      {CARDS.map(({ metric, label }) => {
        const delta = latest && previous ? deltaPoints(latest[metric], previous[metric]) : null;
        return (
          <MetricTile
            key={metric}
            label={t(`dashboard.metrics.${label}`)}
            value={latest?.[metric]}
            color={EVAL_METRIC_COLOR[metric]}
            deltaPoints={delta}
            deltaText={delta != null ? formatDelta(delta) : null}
          />
        );
      })}
      <MetricTile
        label={t("dashboard.table.pass").toUpperCase()}
        color="var(--text-primary)"
        raw={latest ? t("evalsTab.passedOf", { passed: latest.cases_passed, total: latest.cases_total }) : NO_DATA}
      />
    </div>
  );
}

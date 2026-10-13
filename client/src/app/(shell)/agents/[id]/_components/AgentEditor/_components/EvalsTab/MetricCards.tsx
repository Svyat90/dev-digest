import { useTranslations } from "next-intl";
import type { AgentEvalRunSummary } from "@devdigest/shared";
import { NO_DATA } from "@/lib/format";
import { deltaPoints, formatDelta, formatPercent } from "./helpers";
import { s } from "./styles";

type Metric = "recall" | "precision" | "citation_accuracy";

const CARDS: { metric: Metric; label: "recall" | "precision" | "citationAccuracy" }[] = [
  { metric: "recall", label: "recall" },
  { metric: "precision", label: "precision" },
  { metric: "citation_accuracy", label: "citationAccuracy" },
];

/** Latest completed run's metrics with the point delta versus the previous one. */
export function MetricCards({
  latest,
  previous,
}: {
  latest: AgentEvalRunSummary | null;
  previous: AgentEvalRunSummary | null;
}) {
  const t = useTranslations("eval");
  return (
    <div style={s.cards}>
      {CARDS.map(({ metric, label }) => {
        const delta = latest && previous ? deltaPoints(latest[metric], previous[metric]) : null;
        return (
          <div key={metric} role="group" aria-label={t(`dashboard.metrics.${label}`)} style={s.card}>
            <div style={s.cardLabel}>{t(`dashboard.metrics.${label}`)}</div>
            <div style={s.cardValue}>{formatPercent(latest?.[metric])}</div>
            {delta != null ? (
              <div style={s.cardSub} title={t("evalsTab.deltaLabel", { points: formatDelta(delta) })}>
                <span>{formatDelta(delta)}</span>
              </div>
            ) : null}
          </div>
        );
      })}
      <div role="group" aria-label={t("dashboard.table.pass")} style={s.card}>
        <div style={s.cardLabel}>{t("dashboard.table.pass").toUpperCase()}</div>
        <div style={s.cardValue}>
          {latest ? t("evalsTab.passedOf", { passed: latest.cases_passed, total: latest.cases_total }) : NO_DATA}
        </div>
      </div>
    </div>
  );
}

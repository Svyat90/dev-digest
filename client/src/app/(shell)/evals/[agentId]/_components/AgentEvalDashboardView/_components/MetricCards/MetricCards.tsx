import { useTranslations } from "next-intl";
import { Icon, Sparkline } from "@devdigest/ui";
import type { AgentEvalRunSummary, EvalTrendPoint } from "@devdigest/shared";
import { deltaPoints, formatPercent, signedNumber, toPercent } from "@/lib/eval-metrics";
import { s } from "./styles";

type Metric = "recall" | "precision" | "citation_accuracy";

const CARDS: { metric: Metric; label: "recall" | "precision" | "citationAccuracy" }[] = [
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
    <div style={s.cards}>
      {CARDS.map(({ metric, label }) => {
        const delta = latest && previous ? deltaPoints(latest[metric], previous[metric]) : null;
        const values = trend.map((p) => toPercent(p[metric])).filter((v): v is number => v != null);
        return (
          <div key={metric} role="group" aria-label={t(`dashboard.metrics.${label}`)} style={s.card}>
            <div style={s.label}>{t(`dashboard.metrics.${label}`)}</div>
            <div style={s.row}>
              <span style={s.value}>{formatPercent(latest?.[metric])}</span>
              {values.length >= 2 ? <Sparkline data={values} w={64} h={22} /> : null}
            </div>
            {delta != null ? (
              <div style={s.delta}>
                {delta > 0 ? <Icon.ArrowUp size={12} aria-hidden /> : null}
                {delta < 0 ? <Icon.ArrowDown size={12} aria-hidden /> : null}
                <span>{t("agentDashboard.deltaPoints", { value: signedNumber(delta) })}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalComparedRun } from "@devdigest/shared";
import { NO_DATA, formatUsd } from "@/lib/format";
import { deltaPoints, formatPercent, signedNumber, signedUsd } from "@/lib/eval-metrics";
import { EVAL_METRIC_COLOR, evalUi, type EvalMetricKey } from "@/components/eval-ui";
import { s } from "./styles";

const METRICS: { key: EvalMetricKey; label: "recall" | "precision" | "citationAccuracy" }[] = [
  { key: "recall", label: "recall" },
  { key: "precision", label: "precision" },
  { key: "citation_accuracy", label: "citationAccuracy" },
];

function Tile({
  label,
  oldText,
  newText,
  color,
  points,
  deltaText,
  arrow = true,
}: {
  label: string;
  oldText: string;
  newText: string;
  color: string;
  points: number | null;
  deltaText: string;
  /** Cost has no up/down glyph: its sign is already in the text. */
  arrow?: boolean;
}) {
  const t = useTranslations("eval");
  const up = (points ?? 0) > 0;
  const down = (points ?? 0) < 0;
  return (
    <div style={s.tile}>
      <div style={evalUi.kicker}>{label}</div>
      {/* One readable string for assistive tech; the styled pair below is presentational. */}
      <span style={s.srOnly}>{t("compare.oldNew", { old: oldText, new: newText })}</span>
      <div style={s.tileValues} aria-hidden>
        <span style={s.oldValue}>{oldText}</span>
        <Icon.ArrowRight size={12} />
        <span style={{ ...s.newValue, fontSize: newText.length > 6 ? 17 : 24, color }}>{newText}</span>
      </div>
      {deltaText ? (
        <span style={{ ...s.delta, color: up ? "var(--ok)" : down ? "var(--crit)" : "var(--text-muted)" }}>
          {arrow && up ? <Icon.ArrowUp size={12} aria-hidden /> : null}
          {arrow && down ? <Icon.ArrowDown size={12} aria-hidden /> : null}
          <span>{deltaText}</span>
        </span>
      ) : null}
    </div>
  );
}

/** Earlier → later per metric with a signed change (sign + arrow, not colour alone). */
export function MetricDeltas({ earlier, later }: { earlier: EvalComparedRun; later: EvalComparedRun }) {
  const t = useTranslations("eval");
  const costKnown = earlier.cost_usd != null && later.cost_usd != null;
  const costDiff = costKnown ? (later.cost_usd as number) - (earlier.cost_usd as number) : null;
  return (
    <div style={s.tiles}>
      {METRICS.map(({ key, label }) => {
        const points = deltaPoints(later[key], earlier[key]);
        return (
          <Tile
            key={key}
            label={t(`dashboard.metrics.${label}`)}
            oldText={formatPercent(earlier[key])}
            newText={formatPercent(later[key])}
            color={EVAL_METRIC_COLOR[key]}
            points={points}
            deltaText={points != null ? t("agentDashboard.deltaPoints", { value: signedNumber(points) }) : ""}
          />
        );
      })}
      <Tile
        label={t("compare.cost").toUpperCase()}
        oldText={formatUsd(earlier.cost_usd)}
        newText={formatUsd(later.cost_usd)}
        color="var(--text-primary)"
        points={costDiff == null ? null : costDiff > 0 ? -1 : costDiff < 0 ? 1 : 0}
        deltaText={costDiff != null ? signedUsd(costDiff) : NO_DATA}
        arrow={false}
      />
    </div>
  );
}

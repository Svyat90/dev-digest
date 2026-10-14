"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EvalTrendPoint } from "@/vendor/shared";
import { Icon } from "@devdigest/ui";
import { EVAL_METRIC_COLOR, evalUi } from "@/components/eval-ui";
import { trendRows } from "./helpers";
import { TrendTooltip } from "./TrendTooltip";
import { s } from "./styles";

const SERIES = [
  { key: "recall", legend: "recall", color: EVAL_METRIC_COLOR.recall },
  { key: "precision", legend: "precision", color: EVAL_METRIC_COLOR.precision },
  { key: "citation", legend: "citation", color: EVAL_METRIC_COLOR.citation_accuracy },
] as const;

const MARGIN = { top: 14, right: 14, bottom: 14, left: 4 };
const Y_DOMAIN: [number, number] = [0, 100];

interface TooltipContentProps {
  active?: boolean;
  payload?: { payload?: { index: number } }[];
}

export function TrendChart({ points, truncated }: { points: EvalTrendPoint[]; truncated: boolean }) {
  const t = useTranslations("eval");
  const rows = useMemo(() => trendRows(points), [points]);

  const renderTooltip = ({ active, payload }: TooltipContentProps) => {
    const index = payload?.[0]?.payload?.index;
    const point = active && index != null ? points[index] : undefined;
    return point ? <TrendTooltip point={point} /> : null;
  };

  return (
    <div style={{ ...evalUi.card, ...s.wrap }}>
      <div style={s.header}>
        <span style={s.title}>
          <Icon.TrendingUp size={14} aria-hidden />
          <span style={evalUi.kicker}>{t("dashboard.metricTrend")}</span>
        </span>
        <span style={s.legend}>
          {SERIES.map((l) => (
            <span key={l.key} style={s.legendItem}>
              <span style={{ ...s.swatch, background: l.color }} aria-hidden />
              {t(`dashboard.legend.${l.legend}`)}
            </span>
          ))}
        </span>
      </div>
      {truncated && <div style={s.note}>{t("agentDashboard.trendTruncated")}</div>}
      <div style={s.chart}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={MARGIN} accessibilityLayer>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="index" hide />
            <YAxis
              domain={Y_DOMAIN}
              tick={{ fontSize: 12, fill: "var(--text-muted)" }}
              tickFormatter={(v: number) => `${v}%`}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip content={renderTooltip as never} />
            {SERIES.map((l) => (
              <Line
                key={l.key}
                name={t(`dashboard.legend.${l.legend}`)}
                dataKey={l.key}
                type="linear"
                stroke={l.color}
                strokeWidth={2}
                dot
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

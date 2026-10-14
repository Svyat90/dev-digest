"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EvalTrendPoint } from "@/vendor/shared";
import { trendRows } from "./helpers";
import { TrendTooltip } from "./TrendTooltip";
import { s } from "./styles";

const SERIES = [
  { key: "recall", legend: "recall", color: "var(--accent, #4f46e5)", dash: undefined },
  { key: "precision", legend: "precision", color: "var(--warn, #d97706)", dash: "6 3" },
  { key: "citation", legend: "citation", color: "var(--ok, #059669)", dash: "2 3" },
] as const;

const MARGIN = { top: 14, right: 14, bottom: 8, left: -10 };
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
    <div style={s.wrap}>
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
              width={44}
            />
            <Tooltip content={renderTooltip as never} />
            <Legend />
            {SERIES.map((l) => (
              <Line
                key={l.key}
                name={t(`dashboard.legend.${l.legend}`)}
                dataKey={l.key}
                type="linear"
                stroke={l.color}
                strokeDasharray={l.dash}
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

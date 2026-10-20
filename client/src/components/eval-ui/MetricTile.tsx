import { Icon, Sparkline } from "@devdigest/ui";
import { formatPercent } from "@/lib/eval-metrics";
import { evalUi } from "./styles";

/** A KPI tile: kicker label, big coloured value, signed change and an optional sparkline. */
export function MetricTile({
  label,
  value,
  color,
  deltaPoints,
  deltaText,
  trend,
  raw,
}: {
  label: string;
  /** 0–1 ratio; ignored when `raw` is given. */
  value?: number | null;
  color: string;
  /** Signed whole points; drives the arrow and its colour (never colour alone). */
  deltaPoints?: number | null;
  deltaText?: string | null;
  trend?: number[];
  /** A pre-formatted value (e.g. "17/20") shown in the neutral colour. */
  raw?: string;
}) {
  const up = (deltaPoints ?? 0) > 0;
  const down = (deltaPoints ?? 0) < 0;
  const deltaColor = up ? "var(--ok)" : down ? "var(--crit)" : "var(--text-muted)";
  return (
    <div role="group" aria-label={label} style={evalUi.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={evalUi.kicker}>{label}</div>
        {trend && trend.length >= 2 ? <Sparkline data={trend} color={color} w={64} h={22} /> : null}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: raw != null ? "var(--text-primary)" : color }}>
          {raw ?? formatPercent(value)}
        </span>
        {deltaText ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 12.5, fontWeight: 600, color: deltaColor }}>
            {up ? <Icon.ArrowUp size={12} aria-hidden /> : null}
            {down ? <Icon.ArrowDown size={12} aria-hidden /> : null}
            <span>{deltaText}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

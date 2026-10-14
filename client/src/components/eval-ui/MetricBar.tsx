import { ProgressBar } from "@devdigest/ui";
import { formatPercent, toPercent } from "@/lib/eval-metrics";

/** A thin coloured bar with its whole-percent label (em dash when unknown). */
export function MetricBar({ value, color }: { value: number | null | undefined; color: string }) {
  const pct = toPercent(value);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 112 }}>
      <span style={{ flex: 1, minWidth: 44 }}>
        <ProgressBar value={pct ?? 0} color={color} height={5} />
      </span>
      <span style={{ width: 38, textAlign: "right", fontSize: 12, color: "var(--text-secondary)" }}>
        {formatPercent(value)}
      </span>
    </span>
  );
}

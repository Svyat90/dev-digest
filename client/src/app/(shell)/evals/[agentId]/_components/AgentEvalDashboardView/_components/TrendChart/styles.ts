import type { CSSProperties } from "react";

/** Co-located styles for the metric trend chart. */
export const s = {
  wrap: { width: "100%" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 } satisfies CSSProperties,
  title: { display: "inline-flex", alignItems: "center", gap: 8, color: "var(--text-muted)" } satisfies CSSProperties,
  legend: { display: "inline-flex", alignItems: "center", gap: 14, fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  swatch: { width: 12, height: 3, borderRadius: 2, display: "inline-block" } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)", marginBottom: 8 } satisfies CSSProperties,
  chart: { width: "100%", height: 240 } satisfies CSSProperties,
  tooltip: {
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border-strong)",
    boxShadow: "var(--shadow-modal)",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 12,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
  tooltipTime: { color: "var(--text-muted)" } satisfies CSSProperties,
  tooltipRow: { display: "flex", justifyContent: "space-between", gap: 12 } satisfies CSSProperties,
} as const;

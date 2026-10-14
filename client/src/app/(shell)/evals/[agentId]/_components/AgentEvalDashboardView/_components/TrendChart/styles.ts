import type { CSSProperties } from "react";

/** Co-located styles for the metric trend chart. */
export const s = {
  wrap: { width: "100%" } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)", marginBottom: 8 } satisfies CSSProperties,
  chart: { width: "100%", height: 240 } satisfies CSSProperties,
  tooltip: {
    background: "var(--surface, #fff)",
    border: "1px solid var(--border)",
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

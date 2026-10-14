import type { CSSProperties } from "react";
import type { LineDiffOpType } from "@/lib/line-diff";

const DIFF_BG: Record<LineDiffOpType, string> = {
  add: "var(--ok-bg)",
  remove: "var(--crit-bg)",
  equal: "transparent",
};
const DIFF_COLOR: Record<LineDiffOpType, string> = {
  add: "var(--ok)",
  remove: "var(--crit)",
  equal: "var(--text-secondary)",
};

export const s = {
  body: { display: "flex", flexDirection: "column", gap: 18, padding: "16px 20px", maxHeight: "65vh", overflow: "auto" } satisfies CSSProperties,
  section: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  heading: { margin: 0, fontSize: 12, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)" } satisfies CSSProperties,
  metricRow: { display: "flex", alignItems: "center", gap: 12, fontSize: 13.5 } satisfies CSSProperties,
  metricName: { width: 110, color: "var(--text-secondary)" } satisfies CSSProperties,
  delta: { display: "inline-flex", alignItems: "center", gap: 3, color: "var(--text-secondary)" } satisfies CSSProperties,
  notice: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  changeLine: { fontSize: 13.5, color: "var(--text-primary)" } satisfies CSSProperties,
  change: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  diffBody: { maxHeight: 220, overflow: "auto", fontSize: 12.5, lineHeight: "20px" } satisfies CSSProperties,
  diffLine: (type: LineDiffOpType): CSSProperties => ({
    display: "flex",
    gap: 10,
    background: DIFF_BG[type],
    color: DIFF_COLOR[type],
  }),
  diffMarker: { width: 14, flexShrink: 0, textAlign: "center", opacity: 0.8 } satisfies CSSProperties,
  diffText: { whiteSpace: "pre-wrap", wordBreak: "break-word" } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, padding: "12px 20px" } satisfies CSSProperties,
  hint: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { padding: "0 20px 12px", fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
} as const;

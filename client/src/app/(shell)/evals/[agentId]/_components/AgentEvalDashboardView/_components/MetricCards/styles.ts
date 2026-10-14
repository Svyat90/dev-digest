import type { CSSProperties } from "react";

export const s = {
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 } satisfies CSSProperties,
  card: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  label: { fontSize: 11, letterSpacing: 0.4, color: "var(--text-muted)" } satisfies CSSProperties,
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 2 } satisfies CSSProperties,
  value: { fontSize: 22, fontWeight: 700 } satisfies CSSProperties,
  delta: { display: "inline-flex", alignItems: "center", gap: 2, fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
};

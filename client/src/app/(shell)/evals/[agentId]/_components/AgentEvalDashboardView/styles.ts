import type { CSSProperties } from "react";

export const s = {
  page: { padding: "24px 32px", maxWidth: 1100, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  back: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-secondary)", textDecoration: "none", alignSelf: "flex-start" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, margin: 0, overflowWrap: "anywhere" } satisfies CSSProperties,
  titleLine: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  model: { fontSize: 13, color: "var(--text-secondary)", marginTop: 4, overflowWrap: "anywhere" } satisfies CSSProperties,
  controls: { marginLeft: "auto", display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  field: { display: "flex", flexDirection: "column", minWidth: 150 } satisfies CSSProperties,
  runBox: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 } satisfies CSSProperties,
  note: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { fontSize: 12.5, color: "var(--danger, #e5484d)" } satisfies CSSProperties,
  tableBar: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12.5 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    padding: "6px 8px",
    color: "var(--text-muted)",
    fontWeight: 500,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: { padding: "6px 8px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  empty: { display: "flex", alignItems: "center", gap: 12, padding: "24px 0", color: "var(--text-muted)", fontSize: 13.5 } satisfies CSSProperties,
};

import type { CSSProperties } from "react";

export const s = {
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  caseRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "12px 16px",
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  glyph: { display: "inline-flex", flexShrink: 0 } satisfies CSSProperties,
  caseMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  caseName: { fontSize: 13.5, fontWeight: 600, fontFamily: "var(--font-mono, ui-monospace, monospace)", overflowWrap: "anywhere" } satisfies CSSProperties,
  caseSub: { fontSize: 12, color: "var(--text-muted)", overflowWrap: "anywhere" } satisfies CSSProperties,
  lastRun: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    fontSize: 12,
    color: "var(--text-muted)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  iconBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--text-muted)",
    padding: 4,
    display: "inline-flex",
  } satisfies CSSProperties,
  runReason: { fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
};

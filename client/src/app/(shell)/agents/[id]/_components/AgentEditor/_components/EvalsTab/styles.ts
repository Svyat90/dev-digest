import type { CSSProperties } from "react";

export const s = {
  section: { marginBottom: 28 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 10 } satisfies CSSProperties,
  h2: { fontSize: 17, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  meta: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  spacer: { marginLeft: "auto" } satisfies CSSProperties,
  message: { fontSize: 13, color: "var(--text-muted)", padding: "10px 0" } satisfies CSSProperties,
  pill: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 10px",
    borderRadius: 99,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--ok)",
    background: "var(--ok-bg)",
  } satisfies CSSProperties,
};

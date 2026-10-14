import type { CSSProperties } from "react";

export const s = {
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--warning, #d97706)",
    background: "var(--bg-elevated)",
    fontSize: 13,
    marginBottom: 16,
  } satisfies CSSProperties,
  icon: { flexShrink: 0, marginTop: 2, color: "var(--warning, #d97706)" } satisfies CSSProperties,
  text: { margin: 0, lineHeight: 1.5 } satisfies CSSProperties,
  notice: { display: "block", color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
};

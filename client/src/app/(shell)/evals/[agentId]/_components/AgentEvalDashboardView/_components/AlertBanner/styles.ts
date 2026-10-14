import type { CSSProperties } from "react";

export const s = {
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 16px",
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--warn, #d97706)",
    background: "var(--warn-bg)",
    fontSize: 13,
      } satisfies CSSProperties,
  icon: { flexShrink: 0, marginTop: 2, color: "var(--warn, #d97706)" } satisfies CSSProperties,
  text: { margin: 0, lineHeight: 1.5 } satisfies CSSProperties,
  notice: { display: "block", color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
};

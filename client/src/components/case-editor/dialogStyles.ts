import type { CSSProperties } from "react";

/** Co-located styles for the Case Editor dialog shell (the input pieces use ./styles). */
export const ds = {
  body: { display: "flex", flexDirection: "column", gap: 16, padding: "18px 24px" } as CSSProperties,
  name: { display: "flex", flexDirection: "column", gap: 4 } as CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } as CSSProperties,
  footerStart: { display: "flex", alignItems: "center", gap: 12, marginRight: "auto" } as CSSProperties,
  switch: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: 0,
    background: "transparent",
    border: "none",
    color: "var(--text-secondary)",
    fontSize: 13,
    cursor: "pointer",
  } as CSSProperties,
  track: (on: boolean): CSSProperties => ({
    position: "relative",
    width: 28,
    height: 16,
    borderRadius: 8,
    background: on ? "var(--accent)" : "var(--border-strong)",
    transition: "background .12s",
  }),
  knob: (on: boolean): CSSProperties => ({
    position: "absolute",
    top: 2,
    left: on ? 14 : 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    background: "var(--bg-elevated)",
    transition: "left .12s",
  }),
  muted: { color: "var(--text-muted)", fontSize: 12 } as CSSProperties,
  alert: { color: "var(--crit)", fontSize: 12 } as CSSProperties,
};

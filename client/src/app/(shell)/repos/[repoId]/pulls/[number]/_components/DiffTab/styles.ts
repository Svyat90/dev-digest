import type { CSSProperties } from "react";

/** Co-located styles for the Smart Diff header and role groups. */
export const s = {
  header: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  headerIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  headerLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  headerStats: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  headerSpacer: { flex: 1 } satisfies CSSProperties,
  segmented: {
    display: "inline-flex",
    border: "1px solid var(--border-strong)",
    borderRadius: 6,
    overflow: "hidden",
  } satisfies CSSProperties,
  groups: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  roleGroup: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  roleHeader: {
    position: "sticky",
    // Sticks right below PrDetailHeader, which is ALSO sticky at `top: 0`
    // and would otherwise cover this header at the same y. `--pr-header-h`
    // is that header's measured (not hard-coded) height, published on the
    // PrDetailView root by `PrDetailHeader/useHeaderHeightVar.ts`; the
    // `0px` fallback keeps this header at the viewport top when rendered
    // without that ancestor (e.g. DiffTab.test.tsx).
    top: "var(--pr-header-h, 0px)",
    zIndex: 2,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "10px 12px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  roleSwatch: { width: 10, height: 10, borderRadius: 3, flexShrink: 0 } satisfies CSSProperties,
  roleLabel: { fontSize: 13, fontWeight: 600, flexShrink: 0 } satisfies CSSProperties,
  roleDescription: {
    fontSize: 12,
    color: "var(--text-muted)",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  roleFindings: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
    flexShrink: 0,
  } satisfies CSSProperties,
  roleFindingsDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--crit)",
    flexShrink: 0,
  } satisfies CSSProperties,
  roleFilesCount: { fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 } satisfies CSSProperties,
  roleBody: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
} as const;

/** Segmented-toggle button: fully self-contained per state (no `border`
 *  shorthand mixed with a longhand override — client INSIGHTS). */
export function segmentButton(active: boolean): CSSProperties {
  return {
    padding: "5px 10px",
    fontSize: 12.5,
    fontWeight: 500,
    background: active ? "var(--accent)" : "var(--bg-elevated)",
    color: active ? "#fff" : "var(--text-secondary)",
    border: "none",
    cursor: "pointer",
  };
}

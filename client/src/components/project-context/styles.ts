import type { CSSProperties } from "react";

/** Co-located styles for the project-context components. */
export const s = {
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 } as CSSProperties,
  // Longhand border only: the drag-over / selected variant changes one facet.
  row: (highlighted: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: highlighted ? "var(--accent)" : "var(--border)",
    background: "var(--bg-elevated)",
  }),
  handle: { cursor: "grab", color: "var(--text-muted)", userSelect: "none" } as CSSProperties,
  pathBtn: {
    flex: 1,
    textAlign: "left",
    background: "none",
    border: "none",
    padding: 0,
    color: "inherit",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    cursor: "pointer",
  } as CSSProperties,
  moves: { display: "flex", gap: 2 } as CSSProperties,
  iconBtn: {
    background: "none",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: 6,
    padding: "0 6px",
    color: "inherit",
    cursor: "pointer",
  } as CSSProperties,
  tag: {
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    color: "var(--text-muted)",
  } as CSSProperties,
  tokens: { fontSize: 11, color: "var(--text-muted)", display: "inline-flex", gap: 6, alignItems: "center" } as CSSProperties,
  badge: {
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: 999,
    background: "var(--bg-subtle, rgba(128,128,128,.15))",
    color: "var(--text-muted)",
  } as CSSProperties,
  preview: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: 10,
    padding: 12,
    overflow: "auto",
  } as CSSProperties,
  previewHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } as CSSProperties,
  path: { fontSize: 12 } as CSSProperties,
  // Context tabs: list on the left, preview on the right — the same split as
  // the Project Context page. The preview column sticks so it stays in view
  // while a long list scrolls.
  split: {
    display: "grid",
    gridTemplateColumns: "minmax(280px, 1fr) minmax(320px, 1.4fr)",
    gap: 20,
    alignItems: "start",
  } as CSSProperties,
  // Sticks to the top of the editor body (the scroll container); the height
  // leaves room for the app header, the editor header with its tabs and the
  // body padding, so the preview's bottom stays on screen and it scrolls on its own.
  previewColumn: {
    position: "sticky",
    top: 0,
    maxHeight: "calc(100vh - 220px)",
    overflowY: "auto",
  } as CSSProperties,
  previewPrompt: { color: "var(--text-muted)", fontSize: 14, padding: 24 } as CSSProperties,
};

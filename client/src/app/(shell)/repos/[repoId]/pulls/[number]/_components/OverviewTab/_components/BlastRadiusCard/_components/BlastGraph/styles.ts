import type { CSSProperties } from "react";
import type { GraphNodeKind } from "./helpers";

export const s = {
  // overflow hidden + min-width 0: the graph can never push the card wider.
  root: {
    minWidth: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  empty: {
    fontSize: 14,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  svg: {
    display: "block",
    width: "100%",
    height: "auto",
  } satisfies CSSProperties,
  edge: {
    fill: "none",
    stroke: "var(--border)",
    strokeWidth: 1.25,
  } satisfies CSSProperties,
  text: {
    fontSize: 11.5,
    fontWeight: 600,
    textAnchor: "middle",
    dominantBaseline: "central",
  } satisfies CSSProperties,
  legend: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 14px",
    margin: 0,
    padding: 0,
    listStyle: "none",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;

export const NODE_STYLES: Record<GraphNodeKind, { box: CSSProperties; text: CSSProperties }> = {
  symbol: {
    box: { fill: "var(--bg-elevated)", stroke: "var(--accent)", strokeWidth: 1.5 },
    text: { fill: "var(--text-primary)" },
  },
  caller: {
    box: { fill: "var(--bg-hover)", stroke: "var(--border)", strokeWidth: 1 },
    text: { fill: "var(--text-primary)" },
  },
  endpoint: {
    box: { fill: "var(--accent-bg)", stroke: "var(--accent)", strokeWidth: 1 },
    text: { fill: "var(--accent-text)" },
  },
  cron: {
    box: { fill: "var(--warn-bg)", stroke: "var(--warn)", strokeWidth: 1 },
    text: { fill: "var(--warn)" },
  },
  more: {
    box: { fill: "none", stroke: "var(--border)", strokeWidth: 1, strokeDasharray: "4 3" },
    text: { fill: "var(--text-muted)" },
  },
};

/** Legend dot colours, matching the node outlines above. */
export const LEGEND_COLORS = {
  symbol: "var(--accent)",
  caller: "var(--info)",
  endpoint: "var(--accent-text)",
} as const;

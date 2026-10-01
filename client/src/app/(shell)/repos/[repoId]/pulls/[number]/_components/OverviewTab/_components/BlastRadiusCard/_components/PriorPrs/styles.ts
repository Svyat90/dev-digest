import type { CSSProperties } from "react";

export const s = {
  wrap: {
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: "var(--border)",
    paddingTop: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "transparent",
    borderWidth: 0,
    padding: 0,
    cursor: "pointer",
    color: "var(--text-secondary)",
    fontSize: 13,
    fontWeight: 600,
    textAlign: "left",
  } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 14,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  rowHead: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 8,
  } satisfies CSSProperties,
  link: {
    color: "var(--accent)",
    fontWeight: 600,
    textDecoration: "none",
  } satisfies CSSProperties,
  title: {
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  meta: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  chips: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  } satisfies CSSProperties,
  muted: {
    fontSize: 14,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  status: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "var(--warn)",
  } satisfies CSSProperties,
  skeletonStack: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
} as const;

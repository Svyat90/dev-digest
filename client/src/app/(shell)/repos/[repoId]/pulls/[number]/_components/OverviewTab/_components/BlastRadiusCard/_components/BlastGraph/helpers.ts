import type { DownstreamImpact } from "@devdigest/shared";

export type GraphColumn = "symbol" | "caller" | "endpoint";
export type GraphNodeKind = "symbol" | "caller" | "endpoint" | "cron" | "more";

/** View limits: how much the SVG draws. Unrelated to the server's per-symbol caller cap. */
export interface GraphLimits {
  /** Nodes drawn per column before the rest collapses into one "+N more" node. */
  maxPerColumn: number;
  /** Label length (characters) per column before it is cut with an ellipsis. */
  maxChars: Record<GraphColumn, number>;
}

export const GRAPH_LIMITS: GraphLimits = {
  maxPerColumn: 12,
  maxChars: { symbol: 22, caller: 22, endpoint: 26 },
};

/** Fixed coordinate space; the SVG scales it with `viewBox`. */
export const GRAPH_WIDTH = 720;
export const NODE_HEIGHT = 28;
export const NODE_GAP = 10;
const PADDING_Y = 8;
const COLUMN_X: Record<GraphColumn, number> = { symbol: 4, caller: 280, endpoint: 520 };
const COLUMN_WIDTH: Record<GraphColumn, number> = { symbol: 180, caller: 160, endpoint: 196 };

export interface GraphNode {
  id: string;
  column: GraphColumn;
  kind: GraphNodeKind;
  /** Possibly truncated text drawn in the node. */
  label: string;
  /** Untruncated text, for the tooltip. `more` nodes carry their hidden count instead. */
  full: string;
  hidden?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /** SVG path `d` attribute: a cubic curve between the two node edges. */
  path: string;
}

export interface BlastGraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  height: number;
}

/** Cut `text` to `max` characters, ending in an ellipsis when it was longer. */
export function truncateLabel(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

interface Entry {
  id: string;
  kind: GraphNodeKind;
  text: string;
}

const dedupe = (entries: Entry[]): Entry[] => [...new Map(entries.map((e) => [e.id, e])).values()];

/**
 * Three columns: changed symbols, unique caller names, unique endpoints and
 * crons. The contract carries endpoints/crons per symbol group (not per
 * caller), so edges run symbol -> caller and symbol -> endpoint/cron only.
 * Each column shows at most `limits.maxPerColumn` nodes; an edge whose far end
 * is hidden is not drawn.
 */
export function layoutBlastGraph(
  downstream: readonly DownstreamImpact[],
  limits: GraphLimits = GRAPH_LIMITS,
): BlastGraphLayout {
  const symbolEntries = dedupe(downstream.map((g) => ({ id: `s:${g.symbol}`, kind: "symbol" as const, text: g.symbol })));
  const callerEntries = dedupe(
    downstream.flatMap((g) => g.callers.map((c) => ({ id: `c:${c.name}`, kind: "caller" as const, text: c.name }))),
  );
  const targetEntries = dedupe(
    downstream.flatMap((g) => [
      ...g.endpoints_affected.map((e) => ({ id: `e:${e}`, kind: "endpoint" as const, text: e })),
      ...g.crons_affected.map((c) => ({ id: `k:${c}`, kind: "cron" as const, text: c })),
    ]),
  );

  const columns: [GraphColumn, Entry[]][] = [
    ["symbol", symbolEntries],
    ["caller", callerEntries],
    ["endpoint", targetEntries],
  ];

  const shown = columns.map(([column, entries]) => {
    const visible = entries.slice(0, limits.maxPerColumn);
    const rows: (Entry & { hidden?: number })[] = [...visible];
    const rest = entries.length - visible.length;
    if (rest > 0) rows.push({ id: `more:${column}`, kind: "more", text: `+${rest}`, hidden: rest });
    return { column, rows };
  });

  const columnHeight = (n: number) => (n === 0 ? 0 : n * NODE_HEIGHT + (n - 1) * NODE_GAP);
  const tallest = Math.max(0, ...shown.map((c) => columnHeight(c.rows.length)));

  const nodes: GraphNode[] = shown.flatMap(({ column, rows }) => {
    const top = PADDING_Y + (tallest - columnHeight(rows.length)) / 2; // centre shorter columns
    return rows.map((row, i) => ({
      id: row.id,
      column,
      kind: row.kind,
      label: row.kind === "more" ? row.text : truncateLabel(row.text, limits.maxChars[column]),
      full: row.text,
      hidden: row.hidden,
      x: COLUMN_X[column],
      y: top + i * (NODE_HEIGHT + NODE_GAP),
      width: COLUMN_WIDTH[column],
      height: NODE_HEIGHT,
    }));
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: GraphEdge[] = [];
  const link = (fromId: string, toId: string) => {
    const a = byId.get(fromId);
    const b = byId.get(toId);
    if (!a || !b) return;
    const id = `${fromId}>${toId}`;
    if (edges.some((e) => e.id === id)) return;
    edges.push({ id, from: fromId, to: toId, path: curve(a, b) });
  };
  for (const g of downstream) {
    for (const c of g.callers) link(`s:${g.symbol}`, `c:${c.name}`);
    for (const e of g.endpoints_affected) link(`s:${g.symbol}`, `e:${e}`);
    for (const c of g.crons_affected) link(`s:${g.symbol}`, `k:${c}`);
  }

  return { nodes, edges, height: tallest + PADDING_Y * 2 };
}

/** Smooth S-curve from the right edge of `a` to the left edge of `b`. */
function curve(a: GraphNode, b: GraphNode): string {
  const x1 = a.x + a.width;
  const y1 = a.y + a.height / 2;
  const x2 = b.x;
  const y2 = b.y + b.height / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

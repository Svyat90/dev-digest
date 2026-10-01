import { describe, it, expect } from "vitest";
import type { DownstreamImpact } from "@devdigest/shared";
import { GRAPH_LIMITS, layoutBlastGraph, truncateLabel } from "./helpers";

const caller = (name: string) => ({ name, file: "f.ts", line: 1 });
const group = (symbol: string, callers: string[], endpoints: string[] = [], crons: string[] = []): DownstreamImpact => ({
  symbol,
  callers: callers.map(caller),
  endpoints_affected: endpoints,
  crons_affected: crons,
});

describe("layoutBlastGraph", () => {
  it("builds three columns, dedupes shared callers/endpoints and draws one edge per link", () => {
    const { nodes, edges, height } = layoutBlastGraph([
      group("a", ["x", "y"], ["GET /u"], ["* * * * *"]),
      group("b", ["y"], ["GET /u"]),
    ]);
    expect(nodes.filter((n) => n.kind === "symbol")).toHaveLength(2);
    expect(nodes.filter((n) => n.kind === "caller")).toHaveLength(2); // y shared
    expect(nodes.filter((n) => n.kind === "endpoint")).toHaveLength(1);
    expect(nodes.filter((n) => n.kind === "cron")).toHaveLength(1);
    // a->x, a->y, a->GET, a->cron, b->y, b->GET
    expect(edges).toHaveLength(6);
    expect(height).toBeGreaterThan(0);
    const xs = (k: string) => new Set(nodes.filter((n) => n.column === k).map((n) => n.x));
    expect(xs("symbol").size + xs("caller").size + xs("endpoint").size).toBe(3);
  });

  it("caps a column with a +N more node and skips edges to hidden nodes", () => {
    const names = Array.from({ length: 15 }, (_, i) => `c${i}`);
    const { nodes, edges } = layoutBlastGraph([group("a", names)]);
    const callerNodes = nodes.filter((n) => n.column === "caller");
    expect(callerNodes).toHaveLength(GRAPH_LIMITS.maxPerColumn + 1);
    expect(callerNodes.at(-1)).toMatchObject({ kind: "more", hidden: 3 });
    expect(edges).toHaveLength(GRAPH_LIMITS.maxPerColumn);
  });

  it("truncates by character count", () => {
    expect(truncateLabel("short", 10)).toBe("short");
    expect(truncateLabel("abcdefghij", 5)).toBe("abcd…");
  });
});

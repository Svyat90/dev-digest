import { describe, it, expect } from "vitest";
import type { AttachedDoc, ContextDoc } from "@devdigest/shared";
import { mergeRows, toggleAttached, moveAttached, reorderAttached } from "./helpers";

const doc = (path: string): ContextDoc => ({ path, type: "docs", tokens: 10, truncated: false });

const att = (path: string, over: Partial<AttachedDoc> = {}): AttachedDoc => ({
  path,
  type: "docs",
  found: true,
  tokens: 5,
  truncated: false,
  ...over,
});

describe("mergeRows", () => {
  it("puts attached rows first in saved order and keeps a not-found path", () => {
    const rows = mergeRows(
      [doc("docs/a.md"), doc("docs/b.md")],
      [att("docs/b.md"), att("docs/gone.md", { found: false, type: null, tokens: null })],
    );
    expect(rows.map((r) => r.path)).toEqual(["docs/b.md", "docs/gone.md", "docs/a.md"]);
    expect(rows[1]).toMatchObject({ found: false, attached: true, tokens: null });
    expect(rows[2]).toMatchObject({ found: true, attached: false });
  });

  it("trusts the server's found flag for an attached path missing from the listing", () => {
    const rows = mergeRows([], [att("docs/far.md")]);
    expect(rows[0]).toMatchObject({ path: "docs/far.md", found: true, tokens: 5, attached: true });
  });
});

describe("list edits", () => {
  it("toggle appends at the end and removes when present", () => {
    expect(toggleAttached(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleAttached(["a", "b"], "a")).toEqual(["b"]);
  });

  it("move is a no-op at the ends", () => {
    expect(moveAttached(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(moveAttached(["a", "b"], "b", 1)).toEqual(["a", "b"]);
    expect(moveAttached(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveAttached(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
  });

  it("reorder drops the dragged item before the target", () => {
    expect(reorderAttached(["a", "b", "c"], 0, 2)).toEqual(["b", "a", "c"]);
    expect(reorderAttached(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
});

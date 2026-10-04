import type { ContextDoc } from "@devdigest/shared";

/** One row of the attachable list: a found document or an attached path that is gone. */
export interface DocRow {
  path: string;
  type: string | null;
  found: boolean;
  tokens: number | null;
  truncated: boolean;
  attached: boolean;
}

/**
 * Attached rows first, in saved order (a path no longer in `docs` stays as a
 * `found: false` row so it can still be unticked), then the remaining
 * documents in the order given.
 */
export function mergeRows(docs: ContextDoc[], attached: string[]): DocRow[] {
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const attachedSet = new Set(attached);
  const head: DocRow[] = attached.map((path) => {
    const d = byPath.get(path);
    return d
      ? { path, type: d.type, found: true, tokens: d.tokens, truncated: d.truncated, attached: true }
      : { path, type: null, found: false, tokens: null, truncated: false, attached: true };
  });
  const tail: DocRow[] = docs
    .filter((d) => !attachedSet.has(d.path))
    .map((d) => ({
      path: d.path,
      type: d.type,
      found: true,
      tokens: d.tokens,
      truncated: d.truncated,
      attached: false,
    }));
  return [...head, ...tail];
}

/** Untick removes the path; tick appends it at the end. */
export function toggleAttached(paths: string[], path: string): string[] {
  return paths.includes(path) ? paths.filter((p) => p !== path) : [...paths, path];
}

/** Move one step up (-1) or down (1); a no-op at either end. */
export function moveAttached(paths: string[], path: string, dir: -1 | 1): string[] {
  const i = paths.indexOf(path);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= paths.length) return paths;
  const next = [...paths];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Drop the item at `from` right before the item that sits at `to`. */
export function reorderAttached(paths: string[], from: number, to: number): string[] {
  if (from < 0 || from >= paths.length || to < 0 || to > paths.length || from === to) return paths;
  const next = [...paths];
  const [moved] = next.splice(from, 1);
  next.splice(from < to ? to - 1 : to, 0, moved!);
  return next;
}

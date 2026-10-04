import type { AttachedDoc, ContextDoc } from "@devdigest/shared";

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
 * Attached rows first, in saved order, then the remaining documents in the
 * order given. An attached row takes its state from the listing when the path
 * is there, otherwise from the server's own `found` flag: absence from a
 * capped or filtered listing never means "not found".
 */
export function mergeRows(docs: ContextDoc[], own: AttachedDoc[]): DocRow[] {
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const attachedSet = new Set(own.map((a) => a.path));
  const head: DocRow[] = own.map((a) => {
    const d = byPath.get(a.path);
    return d
      ? { path: a.path, type: d.type, found: true, tokens: d.tokens, truncated: d.truncated, attached: true }
      : { path: a.path, type: a.type, found: a.found, tokens: a.tokens, truncated: a.truncated, attached: true };
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

import { MAX_PATH_LENGTH } from './constants.js';

export type DocType = string;

const INSIGHTS_FILE = 'INSIGHTS.md';

function dirSegments(path: string): string[] {
  const parts = path.split('/');
  parts.pop();
  return parts;
}

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? '';
}

/** A document is a `.md` file under a search-root folder, or any `INSIGHTS.md`. */
export function isDocPath(path: string, roots: readonly string[]): boolean {
  if (basename(path) === INSIGHTS_FILE) return true;
  if (!path.endsWith('.md')) return false;
  return dirSegments(path).some((seg) => roots.includes(seg));
}

/** Innermost root folder in the path; `insights` for an `INSIGHTS.md` outside every root. */
export function docTypeFor(path: string, roots: readonly string[]): DocType {
  const dirs = dirSegments(path);
  for (let i = dirs.length - 1; i >= 0; i--) {
    const seg = dirs[i] as string;
    if (roots.includes(seg)) return seg;
  }
  return 'insights';
}

/** Whether a client-supplied path may be attached (no traversal, absolute or odd shapes). */
export function isAttachablePath(path: string, roots: readonly string[]): boolean {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  const segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return false;
  return isDocPath(path, roots);
}

export interface TruncateResult {
  text: string;
  tokens: number;
  truncated: boolean;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Longest prefix of `text` with `count(prefix) <= max`; never splits a surrogate pair. */
export function truncateToTokens(
  text: string,
  max: number,
  count: (text: string) => number,
): TruncateResult {
  const full = count(text);
  if (full <= max) return { text, tokens: full, truncated: false };
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (count(text.slice(0, mid)) <= max) lo = mid;
    else hi = mid - 1;
  }
  if (lo > 0 && isHighSurrogate(text.charCodeAt(lo - 1))) lo -= 1;
  const cut = text.slice(0, lo);
  return { text: cut, tokens: count(cut), truncated: true };
}

/** Agent paths first, then each skill's paths in order; each path keeps its first position. */
export function orderAndDedupe(own: readonly string[], skills: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of [...own, ...skills.flat()]) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

export interface PlanSectionResult<T> {
  kept: T[];
  leftOut: T[];
}

/** Keeps entries while the running token sum stays within `cap`; the first overflow and all later ones are left out. */
export function planSection<T extends { tokens: number }>(
  entries: readonly T[],
  cap: number,
): PlanSectionResult<T> {
  let sum = 0;
  let idx = entries.length;
  for (let i = 0; i < entries.length; i++) {
    sum += (entries[i] as T).tokens;
    if (sum > cap) {
      idx = i;
      break;
    }
  }
  return { kept: entries.slice(0, idx), leftOut: entries.slice(idx) };
}

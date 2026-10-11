import { SEVERITY_ORDER } from "@/lib/severity";

/**
 * Read the `?severity=` filter off the URL.
 *
 * Anything unrecognised reads as "no filter": a hand-edited or stale link must
 * fall back to showing everything, never to an inexplicably empty page.
 */
export function parseSeverityParam(raw: string | null | undefined): string | null {
  return raw && raw in SEVERITY_ORDER ? raw : null;
}

/**
 * Read the `?file=&line=` Files changed target off the URL.
 *
 * A missing/empty file is "no target"; a `line` that is not a positive integer
 * degrades to "no line". The path is only ever a lookup key, never rendered as
 * HTML or used in an href.
 */
export function parseDiffTarget(
  file: string | null,
  line: string | null,
): { path: string; line: number | null } | null {
  if (!file) return null;
  return { path: file, line: line && /^[1-9]\d{0,8}$/.test(line) ? Number(line) : null };
}

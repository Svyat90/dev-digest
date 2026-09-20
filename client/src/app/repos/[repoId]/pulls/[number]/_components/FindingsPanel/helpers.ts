import type { FindingRecord } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/** Optionally drop low-confidence findings and sort by severity. */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severityFilter?: string | null,
): FindingRecord[] {
  let shown = findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  if (severityFilter) shown = shown.filter((f) => f.severity === severityFilter);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

/**
 * Read the `?severity=` filter off the URL.
 *
 * Anything unrecognised reads as "no filter": a hand-edited or stale link must
 * fall back to showing everything, never to an inexplicably empty page.
 */
export function parseSeverityParam(raw: string | null | undefined): string | null {
  return raw && raw in SEVERITY_ORDER ? raw : null;
}

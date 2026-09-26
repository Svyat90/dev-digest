/* Pure findings-in-diff logic for the DiffViewer (Files changed tab). Twin of
   comments.ts: a finding is partitioned against the same rendered-line keys as
   a GitHub comment thread, so a finding whose line is not in the current patch
   (deleted context, a stale diff) surfaces in an off-patch block instead of
   silently disappearing. No React import — this is tier-1 domain logic. */
import type { FindingActionKind, FindingRecord, Severity } from "@devdigest/shared";
import { SEVERITY_ORDER } from "@/lib/severity";
import { lineKey } from "./comments";

/** What the viewer needs to read + act on inline findings for one file. */
export interface DiffFindingApi {
  findings: FindingRecord[];
  onAction: (finding: FindingRecord, action: FindingActionKind) => void;
  pending: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}

/** A finding counts as "open" until it is dismissed (accepted ones still show). */
export function isOpenFinding(finding: FindingRecord): boolean {
  return !finding.dismissed_at;
}

/** The RIGHT-side line key a finding anchors to (findings never bind LEFT). */
export function findingLineKey(finding: FindingRecord): string | null {
  return lineKey("RIGHT", finding.start_line);
}

/**
 * Split a file's findings into those that land on a rendered line and those
 * that do not (off-patch), mirroring partitionThreads.
 */
export function partitionFindings(
  fileFindings: FindingRecord[],
  renderedKeys: Set<string>,
): { matched: Map<string, FindingRecord[]>; offPatch: FindingRecord[] } {
  const matched = new Map<string, FindingRecord[]>();
  const offPatch: FindingRecord[] = [];
  for (const finding of fileFindings) {
    const key = findingLineKey(finding);
    if (key && renderedKeys.has(key)) {
      const list = matched.get(key) ?? [];
      list.push(finding);
      matched.set(key, list);
    } else {
      offPatch.push(finding);
    }
  }
  return { matched, offPatch };
}

/** The most severe OPEN finding's severity, or null when all are dismissed. */
export function topSeverity(findings: FindingRecord[]): Severity | null {
  let best: Severity | null = null;
  for (const finding of findings) {
    if (!isOpenFinding(finding)) continue;
    const rank = SEVERITY_ORDER[finding.severity] ?? 9;
    if (best === null || rank < (SEVERITY_ORDER[best] ?? 9)) {
      best = finding.severity;
    }
  }
  return best;
}

/** i18n sub-key (under smartDiff.severityLine) for each severity's line label. */
export const SEVERITY_LINE_KEY: Record<Severity, string> = {
  CRITICAL: "CRITICAL",
  WARNING: "WARNING",
  SUGGESTION: "SUGGESTION",
};

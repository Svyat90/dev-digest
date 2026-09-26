import type { SmartDiff, SmartDiffRole } from '@devdigest/shared';
import { classifyFile } from './classify.js';
import { ROLE_ORDER } from './constants.js';

/**
 * Local structural input types — deliberately NOT imported from `repository.ts`
 * (see server INSIGHTS "no container facade for this service; local row-like
 * types in helpers" and the `no-circular` trap it documents): the repository's
 * real row types satisfy these shapes structurally, so no back-edge forms.
 */
export interface SmartDiffFileInput {
  path: string;
  additions: number;
  deletions: number;
}

export interface FindingAnchorInput {
  file: string;
  startLine: number;
  dismissedAt: Date | null;
}

/**
 * Builds the Smart Diff response: classifies each file, buckets it by role
 * while keeping the caller's (GitHub) order, emits groups in `ROLE_ORDER`
 * skipping empty ones, and rolls up each file's non-dismissed finding lines.
 * Pure — no DB, no HTTP, no model call.
 */
export function buildSmartDiff(files: SmartDiffFileInput[], anchors: FindingAnchorInput[]): SmartDiff {
  const linesByFile = new Map<string, Set<number>>();
  for (const a of anchors) {
    if (a.dismissedAt !== null) continue;
    let lines = linesByFile.get(a.file);
    if (!lines) {
      lines = new Set<number>();
      linesByFile.set(a.file, lines);
    }
    lines.add(a.startLine);
  }

  const byRole = new Map<SmartDiffRole, SmartDiffFileInput[]>();
  for (const file of files) {
    const role = classifyFile(file.path);
    let bucket = byRole.get(role);
    if (!bucket) {
      bucket = [];
      byRole.set(role, bucket);
    }
    bucket.push(file);
  }

  const groups = ROLE_ORDER.filter((role) => byRole.has(role)).map((role) => ({
    role,
    files: (byRole.get(role) ?? []).map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: [...(linesByFile.get(file.path) ?? [])].sort((a, b) => a - b),
    })),
  }));

  const total_lines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);

  return {
    groups,
    split_suggestion: { too_big: false, total_lines, proposed_splits: [] },
  };
}

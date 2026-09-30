/**
 * Pure grouping/counting logic for the Smart Diff header and role groups. No
 * React import: this is tier-1 domain logic (frontend-ui-architecture §4),
 * consumed by `DiffTab.tsx` during render.
 */
import type { FindingRecord, PrFile, ReviewRecord, SmartDiffResponse, SmartDiffRole } from "@devdigest/shared";
import { latestReviewPerAgent } from "@/components/findings-preview/helpers";

/**
 * The findings that count for Smart Diff: each agent's LATEST `kind==='review'`
 * review, flattened. This is the same input shape the server's
 * `pickLatestReviewIds` picks from — root INSIGHTS "latest review per agent is
 * defined twice": reuse `latestReviewPerAgent`, never redefine it here.
 */
export function latestFindings(reviews: ReviewRecord[]): FindingRecord[] {
  return latestReviewPerAgent(reviews.filter((r) => r.kind === "review")).flatMap(
    (r) => r.findings,
  );
}

/** Whether at least one `kind==='review'` review exists (drives the empty state). */
export function hasAnyReview(reviews: ReviewRecord[]): boolean {
  return reviews.some((r) => r.kind === "review");
}

/** Group findings by the file path they were raised on. */
export function findingsByPath(findings: FindingRecord[]): Map<string, FindingRecord[]> {
  const byPath = new Map<string, FindingRecord[]>();
  for (const f of findings) {
    const list = byPath.get(f.file) ?? [];
    list.push(f);
    byPath.set(f.file, list);
  }
  return byPath;
}

/** One role's slice of the diff, ready for `RoleGroup` to render. */
export interface RoleGroupView {
  role: SmartDiffRole;
  files: PrFile[];
  /** Files in this group with at least one OPEN (non-dismissed) finding. */
  filesWithFindings: number;
}

/**
 * Buckets `files` (kept in GitHub order) by the role `smartDiff` assigned each
 * path, in the order `smartDiff.groups` lists them. A path missing from the
 * response — possible during a refresh race — falls back to `core`, so no
 * file is ever dropped; a `core` group is created up front when the response
 * has none. Empty groups are omitted.
 */
export function buildRoleGroups(
  smartDiff: SmartDiffResponse | undefined,
  files: PrFile[],
  byPath: Map<string, FindingRecord[]>,
): RoleGroupView[] {
  const roleByPath = new Map<string, SmartDiffRole>();
  const roleOrder: SmartDiffRole[] = [];
  for (const group of smartDiff?.groups ?? []) {
    roleOrder.push(group.role);
    for (const file of group.files) {
      roleByPath.set(file.path, group.role);
    }
  }
  if (!roleOrder.includes("core")) roleOrder.unshift("core");

  const filesByRole = new Map<SmartDiffRole, PrFile[]>();
  for (const file of files) {
    const role = roleByPath.get(file.path) ?? "core";
    const list = filesByRole.get(role) ?? [];
    list.push(file);
    filesByRole.set(role, list);
  }

  const hasOpenFinding = (path: string) => (byPath.get(path) ?? []).some((f) => !f.dismissed_at);

  return roleOrder
    .map((role) => {
      const roleFiles = filesByRole.get(role) ?? [];
      return {
        role,
        files: roleFiles,
        filesWithFindings: roleFiles.filter((f) => hasOpenFinding(f.path)).length,
      };
    })
    .filter((group) => group.files.length > 0);
}

/** Total file/line counts for the header's "{files} files · +A −D" stat. */
export function diffTotals(files: PrFile[]): { files: number; additions: number; deletions: number } {
  return files.reduce(
    (acc, f) => ({
      files: acc.files + 1,
      additions: acc.additions + f.additions,
      deletions: acc.deletions + f.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}

import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Smart-diff data-access. Owns no table of its own — reads `pull_requests`,
 * `pr_files`, `reviews` and `findings`.
 *
 * `findings` is the one domain table with no `workspace_id` (server INSIGHTS):
 * tenancy reaches a finding only through its review, so `listFindingAnchors`
 * scopes on `reviews.workspaceId` via the join, never on the PR id alone.
 */

export interface PullIdRow {
  id: string;
}

export interface PrFileRow {
  path: string;
  additions: number;
  deletions: number;
}

export interface ReviewHeadRow {
  id: string;
  prId: string;
  agentId: string | null;
}

export interface FindingAnchorRow {
  file: string;
  startLine: number;
  dismissedAt: Date | null;
}

export class SmartDiffRepository {
  constructor(private db: Db) {}

  /** Workspace-scoped PR lookup. Every other method below is called only after this proves the workspace. */
  async getPull(workspaceId: string, prId: string): Promise<PullIdRow | undefined> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /**
   * Changed files of a PR, selected exactly as `pulls/routes.ts` does (same
   * unordered select), which yields the stored GitHub order. `pr_files` has no
   * `workspace_id` of its own — call this only after `getPull` proved the
   * workspace.
   */
  async listFiles(prId: string): Promise<PrFileRow[]> {
    return this.db
      .select({
        path: t.prFiles.path,
        additions: t.prFiles.additions,
        deletions: t.prFiles.deletions,
      })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
  }

  /**
   * Every `kind='review'` review of this PR, newest-first — `pickLatestReviewIds`
   * requires that order to pick each agent's latest review.
   */
  async listReviewHeads(workspaceId: string, prId: string): Promise<ReviewHeadRow[]> {
    return this.db
      .select({ id: t.reviews.id, prId: t.reviews.prId, agentId: t.reviews.agentId })
      .from(t.reviews)
      .where(
        and(
          eq(t.reviews.prId, prId),
          eq(t.reviews.workspaceId, workspaceId),
          eq(t.reviews.kind, 'review'),
        ),
      )
      .orderBy(desc(t.reviews.createdAt));
  }

  /**
   * Finding anchors for the given reviews, tenancy-scoped through the `reviews`
   * join — see the class doc comment. Returns `[]` without querying when
   * `reviewIds` is empty (an unreviewed PR has none).
   */
  async listFindingAnchors(workspaceId: string, reviewIds: string[]): Promise<FindingAnchorRow[]> {
    if (reviewIds.length === 0) return [];
    return this.db
      .select({
        file: t.findings.file,
        startLine: t.findings.startLine,
        dismissedAt: t.findings.dismissedAt,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(and(inArray(t.findings.reviewId, reviewIds), eq(t.reviews.workspaceId, workspaceId)));
  }
}

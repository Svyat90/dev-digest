import { and, eq, lt } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { FindingRow, PullRow } from '../../db/rows.js';

export interface NewPrFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface NewPrCommit {
  sha: string;
  message: string;
  author: string;
  committedAt: Date | null;
}

export class PullSyncRepository {
  constructor(private db: Db) {}

  async getPull(prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db.select().from(t.pullRequests).where(eq(t.pullRequests.id, prId));
    return row;
  }

  async getRepo(workspaceId: string, repoId: string) {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async listStale(olderThan: Date): Promise<PullRow[]> {
    return this.db.select().from(t.pullRequests).where(lt(t.pullRequests.updatedAt, olderThan));
  }

  async openFindings(prId: string): Promise<FindingRow[]> {
    return this.db
      .select({ f: t.findings })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(eq(t.reviews.prId, prId))
      .then((rows) => rows.map((r) => r.f));
  }

  async deleteFiles(prId: string): Promise<void> {
    await this.db.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
  }

  async insertFiles(prId: string, files: NewPrFile[]): Promise<void> {
    if (files.length === 0) return;
    await this.db.insert(t.prFiles).values(files.map((f) => ({ prId, ...f })));
  }

  async deleteCommits(prId: string): Promise<void> {
    await this.db.delete(t.prCommits).where(eq(t.prCommits.prId, prId));
  }

  async insertCommits(prId: string, commits: NewPrCommit[]): Promise<void> {
    if (commits.length === 0) return;
    await this.db.insert(t.prCommits).values(commits.map((c) => ({ prId, ...c })));
  }

  async updatePull(
    prId: string,
    patch: Partial<Pick<PullRow, 'headSha' | 'additions' | 'deletions' | 'filesCount' | 'updatedAt'>>,
  ): Promise<void> {
    await this.db.update(t.pullRequests).set(patch).where(eq(t.pullRequests.id, prId));
  }
}

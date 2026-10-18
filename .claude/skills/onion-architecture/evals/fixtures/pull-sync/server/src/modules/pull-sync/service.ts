import type { GitHubClient } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type { PullRow } from '../../db/rows.js';
import type { PullSyncRepository } from './repository.js';

export interface PullSyncDeps {
  repo: PullSyncRepository;
  github: () => Promise<Pick<GitHubClient, 'getPull' | 'listPullFiles' | 'listPullCommits'>>;
  now: () => Date;
}

export class PullSyncService {
  constructor(private deps: PullSyncDeps) {}

  async sync(workspaceId: string, prId: string): Promise<PullRow> {
    const { repo } = this.deps;
    const pull = await repo.getPull(prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repoRow = await repo.getRepo(workspaceId, pull.repoId);
    if (!repoRow) throw new NotFoundError('Repository not found');

    const gh = await this.deps.github();
    const ref = { owner: repoRow.owner, name: repoRow.name };

    await repo.deleteFiles(prId);
    const files = await gh.listPullFiles(ref, pull.number);
    await repo.insertFiles(
      prId,
      files.map((f) => ({
        path: f.filename,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
      })),
    );

    await repo.deleteCommits(prId);
    const commits = await gh.listPullCommits(ref, pull.number);
    await repo.insertCommits(
      prId,
      commits.map((c) => ({
        sha: c.sha,
        message: c.message,
        author: c.author,
        committedAt: c.date ? new Date(c.date) : null,
      })),
    );

    const remote = await gh.getPull(ref, pull.number);
    await repo.updatePull(prId, {
      headSha: remote.headSha,
      additions: remote.additions,
      deletions: remote.deletions,
      filesCount: files.length,
      updatedAt: this.deps.now(),
    });

    return (await repo.getPull(prId))!;
  }

  async syncStale(workspaceId: string, maxAgeMinutes: number): Promise<number> {
    const cutoff = new Date(this.deps.now().getTime() - maxAgeMinutes * 60_000);
    const stale = await this.deps.repo.listStale(cutoff);
    for (const p of stale) {
      await this.sync(workspaceId, p.id);
    }
    return stale.length;
  }

  async findingsFor(prId: string) {
    return this.deps.repo.openFindings(prId);
  }
}

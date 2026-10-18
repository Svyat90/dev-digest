import type { GitHubClient, RepoRef } from '@devdigest/shared';
import type { RemindersRepository } from './repository.js';

export interface PrLabeler {
  addLabel(repo: RepoRef, n: number, label: string): Promise<void>;
  requestReviewers(repo: RepoRef, n: number, logins: string[]): Promise<void>;
}

export interface RemindersDeps {
  repo: Pick<RemindersRepository, 'listStalePulls' | 'getRepo' | 'countFindings'>;
  github: () => Promise<Pick<GitHubClient, 'currentLogin'> & PrLabeler>;
  now: () => Date;
}

export interface ReminderResult {
  nudged: number;
  skipped: number;
}

const STALE_AFTER_DAYS = 3;
const LABEL = 'needs-attention';

export class RemindersService {
  constructor(private deps: RemindersDeps) {}

  async nudgeStale(workspaceId: string): Promise<ReminderResult> {
    const { repo } = this.deps;
    const cutoff = new Date(this.deps.now().getTime() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    const pulls = await repo.listStalePulls(workspaceId, cutoff);
    const gh = await this.deps.github();
    const me = await gh.currentLogin();

    let nudged = 0;
    let skipped = 0;
    for (const pull of pulls) {
      const repoRow = await repo.getRepo(workspaceId, pull.repoId);
      if (!repoRow) {
        skipped++;
        continue;
      }
      const findings = await repo.countFindings(workspaceId, pull.id);
      if (findings === 0) {
        skipped++;
        continue;
      }
      const ref = { owner: repoRow.owner, name: repoRow.name };
      await gh.addLabel(ref, pull.number, LABEL);
      if (pull.author !== me) {
        await gh.requestReviewers(ref, pull.number, [pull.author]);
      }
      nudged++;
    }
    return { nudged, skipped };
  }
}

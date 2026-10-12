import type { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { LABEL, cutoffFor, loadPullContext, needsNudge } from './helpers.js';
import type { RemindersRepository } from './repository.js';

export interface RemindersDeps {
  repo: Pick<RemindersRepository, 'listStalePulls' | 'getRepo' | 'countFindings'>;
  github: () => Promise<OctokitGitHubClient>;
  now: () => Date;
}

export class RemindersService {
  constructor(private deps: RemindersDeps) {}

  async nudgeStale(workspaceId: string): Promise<{ nudged: number; skipped: number }> {
    const { repo } = this.deps;
    const pulls = await repo.listStalePulls(workspaceId, cutoffFor(this.deps.now()));
    const gh = await this.deps.github();
    const me = await gh.currentLogin();

    const contexts = await Promise.all(pulls.map((p) => loadPullContext(repo, workspaceId, p)));
    const due = contexts.filter((c) => needsNudge(c, me));

    for (const ctx of due) {
      await gh.addLabels(ctx.repo!, ctx.pull.number, [LABEL]);
      await gh.requestReviewers(ctx.repo!, ctx.pull.number, [ctx.pull.author]);
    }
    return { nudged: due.length, skipped: contexts.length - due.length };
  }
}

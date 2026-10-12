import type { GitHubClient } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type { UnitOfWork } from '../../platform/unit-of-work.js';
import type { PublishRepository } from './repository.js';

export interface PublishDeps {
  repo: Pick<PublishRepository, 'getPull' | 'insertPending' | 'markSent' | 'listPending'>;
  github: () => Promise<Pick<GitHubClient, 'postReview'>>;
  uow: UnitOfWork;
}

export class PublishService {
  constructor(private deps: PublishDeps) {}

  async publish(workspaceId: string, prId: string, body: string) {
    const { repo, uow } = this.deps;
    const pull = await repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const gh = await this.deps.github();

    return uow.run(async (tx) => {
      const pending = await repo.insertPending(workspaceId, prId, body, tx);
      const review = await gh.postReview({ owner: pull.owner, name: pull.name }, pull.number, {
        body,
        event: 'COMMENT',
        comments: [],
      });
      return repo.markSent(workspaceId, pending.id, review.id, tx);
    });
  }

  async retryPending(workspaceId: string) {
    const { repo } = this.deps;
    const pending = await repo.listPending(workspaceId);
    let sent = 0;
    for (const p of pending) {
      const pull = await repo.getPull(workspaceId, p.prId);
      if (!pull) continue;
      const gh = await this.deps.github();
      const review = await gh.postReview({ owner: pull.owner, name: pull.name }, pull.number, {
        body: p.body,
        event: 'COMMENT',
        comments: [],
      });
      await repo.markSent(workspaceId, p.id, review.id);
      sent++;
    }
    return { sent };
  }
}

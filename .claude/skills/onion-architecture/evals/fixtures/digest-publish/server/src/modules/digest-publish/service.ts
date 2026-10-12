import type { GitHubClient, LLMProvider } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type { DigestPublishRepository } from './repository.js';

export interface DigestPublishDeps {
  repo: Pick<DigestPublishRepository, 'getPull' | 'getRepo' | 'insert' | 'finish'>;
  github: () => Promise<Pick<GitHubClient, 'postReview'>>;
  llm: () => Promise<LLMProvider>;
}

export class DigestPublishService {
  constructor(private deps: DigestPublishDeps) {}

  async publish(workspaceId: string, prId: string) {
    const { repo } = this.deps;
    const pull = await repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repoRow = await repo.getRepo(workspaceId, pull.repoId);
    if (!repoRow) throw new NotFoundError('Repository not found');

    const llm = await this.deps.llm();
    const summary = await llm.complete({
      model: 'claude-haiku-5-5',
      messages: [
        { role: 'system', content: 'Write a three line summary of this pull request for a changelog.' },
        { role: 'user', content: `${pull.title}\n\n${pull.body ?? ''}` },
      ],
    });

    const digest = await repo.insert(workspaceId, {
      bodyMd: summary.text,
      deliveredTo: `${repoRow.owner}/${repoRow.name}#${pull.number}`,
    });

    const gh = await this.deps.github();
    await gh.postReview({ owner: repoRow.owner, name: repoRow.name }, pull.number, {
      body: summary.text,
      event: 'COMMENT',
      comments: [],
    });

    return repo.finish(workspaceId, digest.id);
  }
}

import type { SmartDiff } from '@devdigest/shared';
import { pickLatestReviewIds } from '../../domain/reviews/latest-review.js';
import { NotFoundError } from '../../platform/errors.js';
import { buildSmartDiff } from './helpers.js';
import type { SmartDiffRepository } from './repository.js';

/**
 * Narrow deps: only the repository methods this service calls, never the
 * whole `Container` (onion-architecture §5 Application). Type-only import of
 * `SmartDiffRepository` so this file names no concrete infrastructure class.
 */
export interface SmartDiffDeps {
  repo: Pick<SmartDiffRepository, 'getPull' | 'listFiles' | 'listReviewHeads' | 'listFindingAnchors'>;
}

export class SmartDiffService {
  constructor(private deps: SmartDiffDeps) {}

  /**
   * read (files, review heads) -> pure decision (latest review per agent,
   * classification, grouping) -> read (finding anchors) -> pure decision
   * (buildSmartDiff). No LLM call, deterministic.
   */
  async get(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.deps.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const [files, reviewHeads] = await Promise.all([
      this.deps.repo.listFiles(prId),
      this.deps.repo.listReviewHeads(workspaceId, prId),
    ]);

    const reviewIds = pickLatestReviewIds(reviewHeads);
    const anchors = await this.deps.repo.listFindingAnchors(workspaceId, reviewIds);

    return buildSmartDiff(files, anchors);
  }
}

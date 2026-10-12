import type { FastifyBaseLogger } from 'fastify';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository.js';
import { scorePull, type RiskLevel } from '../reviews/scoring.js';
import type { ReposRepository } from './repository.js';

export interface RepoHealth {
  repoId: string;
  openPulls: number;
  highRisk: number;
  worst: RiskLevel | null;
}

export class ReposService {
  constructor(
    private container: Container,
    private repo: ReposRepository,
  ) {}

  async health(workspaceId: string, repoId: string, log: FastifyBaseLogger): Promise<RepoHealth> {
    const repoRow = await this.repo.get(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repository not found');

    const pulls = await this.repo.listOpenPulls(workspaceId, repoId);
    const reviews = new ReviewRepository(this.container.db);
    const scores = await Promise.all(pulls.map((p) => scorePull(reviews, workspaceId, p.id, log)));

    const order: RiskLevel[] = ['low', 'medium', 'high'];
    const worst = scores.reduce<RiskLevel | null>(
      (acc, s) => (acc === null || order.indexOf(s.level) > order.indexOf(acc) ? s.level : acc),
      null,
    );

    return {
      repoId,
      openPulls: pulls.length,
      highRisk: scores.filter((s) => s.level === 'high').length,
      worst,
    };
  }
}

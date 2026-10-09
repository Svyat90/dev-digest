import type { RemindersRepository, StalePull } from './repository.js';

export interface PullContext {
  pull: StalePull;
  repo: { owner: string; name: string } | null;
  findings: number;
}

export const STALE_AFTER_DAYS = 3;
export const LABEL = 'needs-attention';

export function cutoffFor(now: Date): Date {
  return new Date(now.getTime() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
}

export async function loadPullContext(
  repo: Pick<RemindersRepository, 'getRepo' | 'countFindings'>,
  workspaceId: string,
  pull: StalePull,
): Promise<PullContext> {
  const [repoRow, findings] = await Promise.all([
    repo.getRepo(workspaceId, pull.repoId),
    repo.countFindings(workspaceId, pull.id),
  ]);
  return { pull, repo: repoRow ?? null, findings };
}

export function needsNudge(ctx: PullContext, me: string): boolean {
  return ctx.repo !== null && ctx.findings > 0 && ctx.pull.author !== me;
}

import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { AppError } from '../../platform/errors.js';

interface PullEvent {
  action: string;
  number: number;
  repository: { full_name: string };
  pull_request: { title: string; user: { login: string }; head: { sha: string }; base: { ref: string }; head_ref?: string };
}

export class WebhooksService {
  constructor(private db: Db) {}

  verify(rawBody: string, signature: string | undefined): void {
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? '';
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    const ok =
      !!signature &&
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!ok) throw new AppError('BAD_SIGNATURE', 'Invalid signature', 401);
  }

  async handlePull(event: PullEvent): Promise<void> {
    const [owner, name] = event.repository.full_name.split('/');
    const [repo] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.owner, owner!), eq(t.repos.name, name!)));
    if (!repo) return;

    await this.db.insert(t.pullRequests).values({
      workspaceId: repo.workspaceId,
      repoId: repo.id,
      number: event.number,
      title: event.pull_request.title,
      author: event.pull_request.user.login,
      branch: event.pull_request.head_ref ?? '',
      base: event.pull_request.base.ref,
      headSha: event.pull_request.head.sha,
      status: 'needs_review',
    });
  }
}

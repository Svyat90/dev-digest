import type { FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import type { PullRow } from '../../db/rows.js';
import type { Container } from '../../platform/container.js';
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { AnthropicProvider } from '../../adapters/llm/anthropic.js';

export interface DigestDto {
  id: string;
  periodStart: string | null;
  periodEnd: string | null;
  bodyMd: string;
  deliveredTo: string | null;
}

export class DigestsService {
  constructor(private container: Container) {}

  async getOne(id: string, reply: FastifyReply) {
    const [row] = await this.container.db.select().from(t.digests).where(eq(t.digests.id, id));
    if (!row) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Digest not found' } });
    }
    return {
      id: row.id,
      periodStart: row.periodStart?.toISOString() ?? null,
      periodEnd: row.periodEnd?.toISOString() ?? null,
      bodyMd: row.bodyMd ?? '',
      deliveredTo: row.deliveredTo,
    };
  }

  async build(
    workspaceId: string,
    pulls: PullRow[],
    tone: 'urgent' | 'routine',
    since: Date,
  ): Promise<DigestDto> {
    const llm = new AnthropicProvider(process.env.ANTHROPIC_API_KEY ?? '');
    const lines = pulls.map((p) => `- #${p.number} ${p.title} (${p.status}) by ${p.author}`);
    const result = await llm.complete({
      model: 'claude-haiku-5-5',
      messages: [
        {
          role: 'system',
          content:
            tone === 'urgent'
              ? 'Summarise these pull requests. Lead with what is blocked and who must act.'
              : 'Summarise these pull requests in a short friendly weekly note.',
        },
        { role: 'user', content: lines.join('\n') },
      ],
    });

    const [row] = await this.container.db
      .insert(t.digests)
      .values({ workspaceId, periodStart: since, periodEnd: new Date(), bodyMd: result.text })
      .returning();

    return {
      id: row!.id,
      periodStart: row!.periodStart?.toISOString() ?? null,
      periodEnd: row!.periodEnd?.toISOString() ?? null,
      bodyMd: row!.bodyMd ?? '',
      deliveredTo: null,
    };
  }

  async deliver(digestId: string, target: string): Promise<void> {
    const [row] = await this.container.db.select().from(t.digests).where(eq(t.digests.id, digestId));
    const github = new OctokitGitHubClient(process.env.GITHUB_TOKEN ?? '');
    const [owner, name, issue] = target.split('/');
    await github.createIssueComment({ owner: owner!, name: name! }, Number(issue), row!.bodyMd ?? '');
    await this.container.db
      .update(t.digests)
      .set({ deliveredTo: target })
      .where(eq(t.digests.id, digestId));
  }
}

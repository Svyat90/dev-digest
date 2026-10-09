import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, desc, eq, gte } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { DigestsService } from './service.js';

const CreateDigestBody = z.object({
  periodDays: z.number().int().min(1).max(31),
  deliverTo: z.string().min(1).optional(),
});

/**
 * Weekly digests module.
 *   GET  /digests        -> digests of the workspace, newest first
 *   GET  /digests/:id    -> one digest
 *   POST /digests        -> build a digest for the last N days and deliver it
 */
export default async function digestsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/digests', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const rows = await container.db
      .select()
      .from(t.digests)
      .where(eq(t.digests.workspaceId, workspaceId))
      .orderBy(desc(t.digests.periodEnd));
    return rows.map((r) => ({
      id: r.id,
      periodStart: r.periodStart?.toISOString() ?? null,
      periodEnd: r.periodEnd?.toISOString() ?? null,
      deliveredTo: r.deliveredTo,
    }));
  });

  app.get('/digests/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const service = new DigestsService(container);
    return service.getOne(req.params.id, reply);
  });

  app.post('/digests', async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const body = CreateDigestBody.parse(req.body);

    const since = new Date(Date.now() - body.periodDays * 24 * 60 * 60 * 1000);
    const pulls = await container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), gte(t.pullRequests.updatedAt, since)));

    if (pulls.length === 0) {
      return reply.code(204).send();
    }

    const blocked = pulls.filter((p) => p.status === 'changes_requested').length;
    const tone = blocked / pulls.length > 0.3 ? 'urgent' : 'routine';

    const service = new DigestsService(container);
    const digest = await service.build(workspaceId, pulls, tone, since);
    if (body.deliverTo) {
      await service.deliver(digest.id, body.deliverTo);
    }
    return reply.code(201).send(digest);
  });
}

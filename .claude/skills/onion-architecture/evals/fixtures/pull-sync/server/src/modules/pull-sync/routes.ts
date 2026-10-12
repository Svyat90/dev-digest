import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PullSyncRepository } from './repository.js';
import { PullSyncService } from './service.js';

const SyncStaleBody = z.object({ maxAgeMinutes: z.number().int().min(1).max(1440) });

/**
 * Pull request re-sync from GitHub.
 *   POST /pulls/:id/sync        -> refetch files, commits and head of one PR
 *   POST /pulls/sync-stale      -> refetch every PR not updated for N minutes
 *   GET  /pulls/:id/sync/findings -> findings attached to the PR
 */
export default async function pullSyncRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = new PullSyncService({
    repo: new PullSyncRepository(container.db),
    github: () => container.github(),
    now: () => new Date(),
  });

  app.post('/pulls/:id/sync', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.sync(workspaceId, req.params.id);
  });

  app.post('/pulls/sync-stale', { schema: { body: SyncStaleBody } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const count = await service.syncStale(workspaceId, req.body.maxAgeMinutes);
    return { synced: count };
  });

  app.get('/pulls/:id/sync/findings', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    return service.findingsFor(req.params.id);
  });
}

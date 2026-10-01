import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BlastRadiusResponse, PrHistoryResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastRepository } from './repository.js';
import { BlastService } from './service.js';
import type { BlastIndexReader } from './types.js';

/**
 * Blast Radius module.
 *   GET /pulls/:id/blast   -> callers / endpoints / crons reached by the PR's changed symbols
 *   GET /pulls/:id/history -> prior merged PRs touching the same files
 * Reads the precomputed repo-intel index; no model call, no re-parse. Responses
 * are validated against their contracts by the zod serializer.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  // Typed as the local port: a drift in the facade's shape is a compile error here.
  const repoIntel: BlastIndexReader = container.repoIntel;
  const service = new BlastService({
    repo: new BlastRepository(container.db),
    repoIntel,
    git: container.git,
    github: () => container.github(),
    logger: app.log,
  });

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, response: { 200: BlastRadiusResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.get(workspaceId, req.params.id);
    },
  );

  app.get(
    '/pulls/:id/history',
    { schema: { params: IdParams, response: { 200: PrHistoryResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.history(workspaceId, req.params.id);
    },
  );
}

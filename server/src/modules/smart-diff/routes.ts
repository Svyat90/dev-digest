import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { SmartDiffResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffRepository } from './repository.js';
import { SmartDiffService } from './service.js';

/**
 * Smart Diff module.
 *   GET /pulls/:id/smart-diff -> the SmartDiff grouping (core/tests/wiring/docs/boilerplate)
 * Deterministic, no model call, works before the first review — the response
 * is validated against the `SmartDiffResponse` contract by the zod serializer.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = new SmartDiffService({ repo: new SmartDiffRepository(container.db) });

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams, response: { 200: SmartDiffResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.get(workspaceId, req.params.id);
    },
  );
}

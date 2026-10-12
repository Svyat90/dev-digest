import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { DigestPublishRepository } from './repository.js';
import { DigestPublishService } from './service.js';

/**
 * Publish a one-off summary of a pull request.
 *   POST /pulls/:id/publish-summary -> summarise the PR, store it and post it as a review comment
 */
export default async function digestPublishRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = new DigestPublishService({
    repo: new DigestPublishRepository(container.db),
    github: () => container.github(),
    llm: () => container.llm('anthropic'),
  });

  app.post('/pulls/:id/publish-summary', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const digest = await service.publish(workspaceId, req.params.id);
    return reply.code(201).send(digest);
  });
}

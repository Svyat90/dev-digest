import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PublishRepository } from './repository.js';
import { PublishService } from './service.js';

const PublicationDto = z.object({
  id: z.string().uuid(),
  prId: z.string().uuid(),
  status: z.enum(['pending', 'sent']),
  reviewId: z.string().nullable(),
});

export default async function publishRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = new PublishService({
    repo: new PublishRepository(container.db),
    github: () => container.github(),
    uow: container.uow,
  });

  app.post(
    '/pulls/:id/publish',
    { schema: { params: IdParams, body: z.object({ body: z.string().min(1) }), response: { 201: PublicationDto } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      return reply.code(201).send(await service.publish(workspaceId, req.params.id, req.body.body));
    },
  );

  app.post('/publish/retry', { schema: { response: { 200: z.object({ sent: z.number().int() }) } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.retryPending(workspaceId);
  });
}

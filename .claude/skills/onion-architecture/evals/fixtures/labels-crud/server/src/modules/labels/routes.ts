import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NotFoundError } from '../../platform/errors.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { LabelsRepository } from './repository.js';

const LabelDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string(),
  createdAt: z.string(),
});

const Color = z.string().regex(/^#[0-9a-f]{6}$/i);

const CreateLabelBody = z.object({
  name: z.string().trim().min(1).max(40),
  color: Color,
});

const UpdateLabelBody = z
  .object({ name: z.string().trim().min(1).max(40).optional(), color: Color.optional() })
  .refine((b) => b.name !== undefined || b.color !== undefined, {
    message: 'Provide name or color',
  });

/**
 * Workspace labels.
 *   GET    /labels      -> all labels, by name
 *   POST   /labels      -> create (or recolor an existing name)
 *   PATCH  /labels/:id  -> rename / recolor
 *   DELETE /labels/:id  -> remove
 */
export default async function labelsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const repo = new LabelsRepository(container.db);

  app.get('/labels', { schema: { response: { 200: z.array(LabelDto) } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return repo.list(workspaceId);
  });

  app.post(
    '/labels',
    { schema: { body: CreateLabelBody, response: { 201: LabelDto } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      return reply.code(201).send(await repo.create(workspaceId, req.body));
    },
  );

  app.patch(
    '/labels/:id',
    { schema: { params: IdParams, body: UpdateLabelBody, response: { 200: LabelDto } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const label = await repo.rename(workspaceId, req.params.id, req.body);
      if (!label) throw new NotFoundError('Label not found');
      return label;
    },
  );

  app.delete('/labels/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const removed = await repo.remove(workspaceId, req.params.id);
    if (!removed) throw new NotFoundError('Label not found');
    return reply.code(204).send();
  });
}

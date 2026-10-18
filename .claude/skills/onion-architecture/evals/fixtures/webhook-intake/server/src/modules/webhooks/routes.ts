import type { FastifyInstance } from 'fastify';
import { WebhooksService } from './service.js';

export default async function webhooksRoutes(app: FastifyInstance) {
  const service = new WebhooksService(app.container.db);

  app.post('/webhooks/github', async (req, reply) => {
    const raw = JSON.stringify(req.body);
    service.verify(raw, req.headers['x-hub-signature-256'] as string | undefined);

    if (req.headers['x-github-event'] === 'pull_request') {
      await service.handlePull(req.body as never);
    }
    return reply.code(202).send({ ok: true });
  });
}

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { CostReportRepository } from './repository.js';
import { CostReportService } from './service.js';

const Query = z.object({
  from: z.coerce.date(),
  days: z.coerce.number().int().min(1).max(90).default(7),
});

export default async function costReportRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new CostReportService({ repo: new CostReportRepository(container.db) });

  app.get('/cost-report', { schema: { querystring: Query } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.report(workspaceId, req.query.from, req.query.days);
  });
}

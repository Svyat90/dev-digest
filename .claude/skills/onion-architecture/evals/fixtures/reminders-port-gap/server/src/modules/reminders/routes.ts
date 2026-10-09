import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { RemindersRepository } from './repository.js';
import { RemindersService, type PrLabeler } from './service.js';

const NudgeResponse = z.object({ nudged: z.number().int(), skipped: z.number().int() });

/**
 * Reminders for pull requests nobody has touched for a while.
 *   POST /reminders/nudge -> label stale PRs that have findings and ask the author to look again
 */
export default async function remindersRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = new RemindersService({
    repo: new RemindersRepository(container.db),
    github: async () => (await container.github()) as Awaited<ReturnType<typeof container.github>> & PrLabeler,
    now: () => new Date(),
  });

  app.post('/reminders/nudge', { schema: { response: { 200: NudgeResponse } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.nudgeStale(workspaceId);
  });
}

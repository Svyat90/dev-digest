import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { getContext } from '../_shared/context.js';
import { RemindersRepository } from './repository.js';
import { RemindersService } from './service.js';

const NudgeResponse = z.object({ nudged: z.number().int(), skipped: z.number().int() });

export default async function remindersRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = new RemindersService({
    repo: new RemindersRepository(container.db),
    github: async () => (await container.github()) as OctokitGitHubClient,
    now: () => new Date(),
  });

  app.post('/reminders/nudge', { schema: { response: { 200: NudgeResponse } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.nudgeStale(workspaceId);
  });
}

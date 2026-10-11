import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrBrief } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefRepository } from './repository.js';
import { BriefService, type BriefLogContext } from './service.js';

/**
 * PR Brief module (SPEC-03).
 *   GET  /pulls/:id/brief -> the stored PrBrief, or null when none was generated yet
 *   POST /pulls/:id/brief -> generate now (one bounded model call), store and return it
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const service = new BriefService({
    repo: new BriefRepository(container.db),
    intent: (ws, id) => container.intent.get(ws, id),
    blast: (ws, id) => container.blast(app.log).get(ws, id),
    smartDiff: (ws, id) => container.smartDiff.get(ws, id),
    enabledAgentIds: async (ws) => (await container.agentsRepo.listEnabled(ws)).map((a) => a.id),
    resolveDocs: (ws, agentId, repo) => container.projectContext.resolveForRun(ws, agentId, repo),
    github: () => container.github(),
    llm: (p) => container.llm(p),
    resolveFeatureModel: (ws, id) => container.resolveFeatureModel(ws, id),
    tokenizer: container.tokenizer,
    promptLogMode: container.config.promptLog,
  });

  /** The request logger plus the ids that tie the generation log to this call. */
  const logOf = (req: FastifyRequest, prId: string): BriefLogContext => ({
    logger: req.log,
    correlation: { pr_id: prId, request_id: req.id },
  });

  app.get('/pulls/:id/brief', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const brief = await service.get(workspaceId, req.params.id);
    // A bare `null` return is an empty body in Fastify; send the JSON literal instead.
    if (brief === null) return reply.type('application/json').send('null');
    return brief;
  });

  // Tight per-route limit: each call is a paid LLM request plus outbound fetches.
  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, response: { 200: PrBrief } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.generate(workspaceId, req.params.id, logOf(req, req.params.id));
    },
  );
}

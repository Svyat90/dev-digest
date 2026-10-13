import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AgentEvalCaseListItem,
  AgentEvalRunDetail,
  AgentEvalRunSummary,
  CreateEvalCaseResponse,
  StartEvalRunResponse,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EVAL_RUN_START_RATE_LIMIT } from './constants.js';

/**
 * Evals module (SPEC-04). Cases are frozen from decided findings; a run scores an
 * agent over all of its cases with no model call in the scoring step.
 *   POST   /findings/:id/eval-case  -> 201 new case | 200 the finding's existing case
 *   GET    /agents/:id/eval-cases   -> the agent's cases with their latest result
 *   DELETE /eval-cases/:id          -> { ok: true } (past results keep their rows)
 *   POST   /agents/:id/eval-runs    -> 202 { run_id }; the run continues in the background
 *   GET    /agents/:id/eval-runs    -> run summaries, newest first
 *   GET    /eval-runs/:id           -> one run with its config, covered cases and results
 */
export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.post(
    '/findings/:id/eval-case',
    {
      schema: {
        params: IdParams,
        response: { 200: CreateEvalCaseResponse, 201: CreateEvalCaseResponse },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const res = await container.evals.createCaseFromFinding(workspaceId, req.params.id);
      return reply.status(res.created ? 201 : 200).send(res);
    },
  );

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: z.array(AgentEvalCaseListItem) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.evals.listCases(workspaceId, req.params.id);
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    await container.evals.deleteCase(workspaceId, req.params.id);
    return { ok: true };
  });

  // Tight per-route limit: a run is many paid model calls.
  app.post(
    '/agents/:id/eval-runs',
    {
      schema: { params: IdParams, response: { 202: StartEvalRunResponse } },
      config: { rateLimit: EVAL_RUN_START_RATE_LIMIT },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      // `app.log`, not `req.log`: the background run outlives the request.
      const res = await container.evals.startRun(workspaceId, req.params.id, app.log);
      return reply.status(202).send(res);
    },
  );

  app.get(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, response: { 200: z.array(AgentEvalRunSummary) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.evals.listRuns(workspaceId, req.params.id);
    },
  );

  app.get(
    '/eval-runs/:id',
    { schema: { params: IdParams, response: { 200: AgentEvalRunDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.evals.getRun(workspaceId, req.params.id);
    },
  );
}

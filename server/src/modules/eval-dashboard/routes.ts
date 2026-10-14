import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EvalDashboard,
  EvalDashboardRange,
  EvalRunComparison,
  EvalWorkspaceDashboard,
  PromoteEvalRunResponse,
  RunAllEvalsResponse,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { runStartGuard } from '../_shared/run-start-guard.js';
import { EvalDashboardRepository } from './repository/dashboard.repo.js';
import { EvalPromotionRepository } from './repository/promotion.repo.js';
import { EvalDashboardService } from './service.js';
import type { EvalRunStarter } from './types.js';

/**
 * Eval Dashboard module (SPEC-05). No model is called by any route here; "Run all agents"
 * reaches the SPEC-04 `startRun` through a structural port.
 *   GET  /eval-dashboard                         -> every agent's latest result + recent runs
 *   POST /eval-dashboard/run-all                 -> 202 { started, skipped } (shared start limit)
 *   GET  /agents/:id/eval-dashboard?range=       -> one agent's dashboard
 *   GET  /agents/:id/eval-runs/compare?a=&b=     -> two completed runs compared
 *   POST /agents/:id/eval-runs/:runId/promote    -> make the run's configuration current
 */
export default async function evalDashboardRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const runs: EvalRunStarter = container.evals;
  const service = new EvalDashboardService({
    dashboard: new EvalDashboardRepository(container.db),
    promotion: new EvalPromotionRepository(container.db),
    runs,
  });

  app.get(
    '/eval-dashboard',
    { schema: { response: { 200: EvalWorkspaceDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.workspace(workspaceId);
    },
  );

  app.post(
    '/eval-dashboard/run-all',
    {
      schema: { response: { 202: RunAllEvalsResponse } },
      preHandler: runStartGuard(container),
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      // `app.log`, not `req.log`: the background runs outlive the request.
      const res = await service.runAll(workspaceId, app.log);
      return reply.status(202).send(res);
    },
  );

  app.get(
    '/agents/:id/eval-dashboard',
    {
      schema: {
        params: IdParams,
        querystring: z.object({ range: EvalDashboardRange.default('30d') }),
        response: { 200: EvalDashboard },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.agentDashboard(workspaceId, req.params.id, req.query.range);
    },
  );

  app.get(
    '/agents/:id/eval-runs/compare',
    {
      schema: {
        params: IdParams,
        querystring: z.object({ a: z.string().uuid(), b: z.string().uuid() }),
        response: { 200: EvalRunComparison },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.compare(workspaceId, req.params.id, req.query.a, req.query.b);
    },
  );

  app.post(
    '/agents/:id/eval-runs/:runId/promote',
    {
      schema: {
        params: z.object({ id: z.string().uuid(), runId: z.string().uuid() }),
        response: { 200: PromoteEvalRunResponse },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.promote(workspaceId, req.params.id, req.params.runId);
    },
  );
}

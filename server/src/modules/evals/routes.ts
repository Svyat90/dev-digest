import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AgentEvalRunDetail,
  AgentEvalRunSummary,
  CreateEvalCaseResponse,
  EvalCaseDetail,
  EvalCaseDraft,
  EvalCaseListItem,
  SaveEvalCaseResponse,
  SetSkillEvalAgentBody,
  SkillEvalAgent,
  SkillEvalRunSummary,
  StartEvalCaseCheckResponse,
  StartEvalRunResponse,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { runStartGuard } from '../_shared/run-start-guard.js';

const CaseParams = z.object({ id: z.string().uuid(), caseId: z.string().uuid() });

/** The two owners of a case set and their path prefix (SPEC-06). */
const OWNER_PATHS = { agent: '/agents', skill: '/skills' } as const;

/**
 * Evals module (SPEC-04, SPEC-06). Cases are frozen from decided findings or
 * written by hand; a run scores an owner's set with no model call in the scoring step.
 *   POST   /findings/:id/eval-case                       -> 201 new case | 200 the finding's existing case
 *   GET    /{agents|skills}/:id/eval-cases               -> the owner's cases with their latest result
 *   POST   /{agents|skills}/:id/eval-cases               -> 201 a manual case at revision 1
 *   GET    /{agents|skills}/:id/eval-cases/:caseId       -> one case at its current revision
 *   PUT    /{agents|skills}/:id/eval-cases/:caseId       -> 200 saved (content edit = new revision)
 *   POST   /{agents|skills}/:id/eval-cases/:caseId/check -> 202 { check_id }; a scratch single-case run
 *   DELETE /eval-cases/:id                               -> { ok: true } (past results keep their rows)
 *   POST   /agents/:id/eval-runs                         -> 202 { run_id }; the run continues in the background
 *   GET    /agents/:id/eval-runs                         -> run summaries, newest first
 *   GET    /skills/:id/eval-agent · PUT                  -> the agent a skill's cases run through
 *   POST   /skills/:id/eval-runs                         -> 202 { run_id }; the skill's cases via that agent
 *   GET    /skills/:id/eval-runs                         -> skill run summaries, newest first
 *   GET    /eval-runs/:id                                -> one run with its config, covered cases and results
 * Every run start shares the per-workspace start limit (`runStartGuard`).
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

  // One handler per action, registered for both owners of a case set.
  for (const kind of ['agent', 'skill'] as const) {
    const base = `${OWNER_PATHS[kind]}/:id/eval-cases`;

    app.get(
      base,
      { schema: { params: IdParams, response: { 200: z.array(EvalCaseListItem) } } },
      async (req) => {
        const { workspaceId } = await getContext(container, req);
        return container.evalCases.listCases(workspaceId, { kind, id: req.params.id });
      },
    );

    app.post(
      base,
      { schema: { params: IdParams, body: EvalCaseDraft, response: { 201: SaveEvalCaseResponse } } },
      async (req, reply) => {
        const { workspaceId } = await getContext(container, req);
        const res = await container.evalCases.createCase(
          workspaceId,
          { kind, id: req.params.id },
          req.body,
        );
        return reply.status(201).send(res);
      },
    );

    app.get(
      `${base}/:caseId`,
      { schema: { params: CaseParams, response: { 200: EvalCaseDetail } } },
      async (req) => {
        const { workspaceId } = await getContext(container, req);
        return container.evalCases.getCase(
          workspaceId,
          { kind, id: req.params.id },
          req.params.caseId,
        );
      },
    );

    app.put(
      `${base}/:caseId`,
      { schema: { params: CaseParams, body: EvalCaseDraft, response: { 200: SaveEvalCaseResponse } } },
      async (req) => {
        const { workspaceId } = await getContext(container, req);
        return container.evalCases.updateCase(
          workspaceId,
          { kind, id: req.params.id },
          req.params.caseId,
          req.body,
        );
      },
    );

    // A single-case run is a model call too: it shares the per-workspace start limit.
    app.post(
      `${base}/:caseId/check`,
      {
        schema: { params: CaseParams, response: { 202: StartEvalCaseCheckResponse } },
        preHandler: runStartGuard(container),
      },
      async (req, reply) => {
        const { workspaceId } = await getContext(container, req);
        // `app.log`, not `req.log`: the background check outlives the request.
        const res = await container.evalCases.startCheck(
          workspaceId,
          { kind, id: req.params.id },
          req.params.caseId,
          app.log,
        );
        return reply.status(202).send(res);
      },
    );
  }

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    await container.evals.deleteCase(workspaceId, req.params.id);
    return { ok: true };
  });

  // Shared per-workspace start limit: a run is many paid model calls.
  app.post(
    '/agents/:id/eval-runs',
    {
      schema: { params: IdParams, response: { 202: StartEvalRunResponse } },
      preHandler: runStartGuard(container),
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
    '/skills/:id/eval-agent',
    { schema: { params: IdParams, response: { 200: SkillEvalAgent } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.evals.getSkillEvalAgent(workspaceId, req.params.id);
    },
  );

  app.put(
    '/skills/:id/eval-agent',
    { schema: { params: IdParams, body: SetSkillEvalAgentBody, response: { 200: SkillEvalAgent } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.evals.setSkillEvalAgent(workspaceId, req.params.id, req.body.agent_id);
    },
  );

  app.post(
    '/skills/:id/eval-runs',
    {
      schema: { params: IdParams, response: { 202: StartEvalRunResponse } },
      preHandler: runStartGuard(container),
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      // `app.log`, not `req.log`: the background run outlives the request.
      const res = await container.evals.startSkillRun(workspaceId, req.params.id, app.log);
      return reply.status(202).send(res);
    },
  );

  app.get(
    '/skills/:id/eval-runs',
    { schema: { params: IdParams, response: { 200: z.array(SkillEvalRunSummary) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.evals.listSkillRuns(workspaceId, req.params.id);
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

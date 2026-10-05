import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AttachContextDocBody, PutContextDocsBody } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

const ListQuery = z.object({ q: z.string().max(200).optional() });
const PathQuery = z.object({ path: z.string().min(1).max(500) });
const RepoQuery = z.object({ repo_id: z.string().uuid() });

/**
 * Project context module (SPEC-01).
 *   GET  /repos/:id/context/docs           -> discovered documents (?q=)
 *   GET  /repos/:id/context/docs/content   -> one document's text (?path=)
 *   GET  /context-docs/usage               -> agents and skills a path is attached to (?path=)
 *   GET|PUT|POST /agents/:id/context-docs  -> an agent's attached paths
 *   GET|PUT|POST /skills/:id/context-docs  -> a skill's attached paths
 * Every handler delegates to `container.projectContext`; the workspace scopes all of them.
 */
export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/repos/:id/context/docs',
    { schema: { params: IdParams, querystring: ListQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.list(workspaceId, req.params.id, req.query.q);
    },
  );

  app.get(
    '/repos/:id/context/docs/content',
    { schema: { params: IdParams, querystring: PathQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.content(workspaceId, req.params.id, req.query.path);
    },
  );

  app.get('/context-docs/usage', { schema: { querystring: PathQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return app.container.projectContext.usage(workspaceId, req.query.path);
  });

  app.get(
    '/agents/:id/context-docs',
    { schema: { params: IdParams, querystring: RepoQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.agentView(workspaceId, req.params.id, req.query.repo_id);
    },
  );

  app.put(
    '/agents/:id/context-docs',
    { schema: { params: IdParams, body: PutContextDocsBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.setAgentDocs(workspaceId, req.params.id, req.body.paths);
    },
  );

  app.post(
    '/agents/:id/context-docs',
    { schema: { params: IdParams, body: AttachContextDocBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.appendAgentDoc(workspaceId, req.params.id, req.body.path);
    },
  );

  app.get(
    '/skills/:id/context-docs',
    { schema: { params: IdParams, querystring: RepoQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.skillView(workspaceId, req.params.id, req.query.repo_id);
    },
  );

  app.put(
    '/skills/:id/context-docs',
    { schema: { params: IdParams, body: PutContextDocsBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.setSkillDocs(workspaceId, req.params.id, req.body.paths);
    },
  );

  app.post(
    '/skills/:id/context-docs',
    { schema: { params: IdParams, body: AttachContextDocBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.projectContext.appendSkillDoc(workspaceId, req.params.id, req.body.path);
    },
  );
}

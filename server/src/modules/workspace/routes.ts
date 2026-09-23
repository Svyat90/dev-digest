import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';

/**
 * F1 — workspace manager: where clones live + a summary of cloned repos.
 *   GET /workspace/summary → workspace info + cloneDir + cloned repos summary
 *
 * Cleanup/re-pull of individual repos is handled by the repos module
 * (refresh/delete); this surface gives the UI an overview.
 */
export default async function workspaceRoutes(app: FastifyInstance) {
  const { container } = app;

  app.get('/workspace/summary', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const repos = await container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.workspaceId, workspaceId));
    return {
      workspace_id: workspaceId,
      clone_dir: container.config.cloneDir,
      repos: repos.map((r) => ({
        id: r.id,
        full_name: r.fullName,
        clone_path: r.clonePath,
        last_polled_at: r.lastPolledAt?.toISOString() ?? null,
        cloned: Boolean(r.clonePath),
      })),
    };
  });
}

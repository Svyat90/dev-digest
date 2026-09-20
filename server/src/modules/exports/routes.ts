import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { exportFindings, purgeFindings, repoSummary, topFiles } from './service.js';
import { paginate, parseLimit, toCsv } from './format.js';

/**
 * Exports module.
 *   GET    /exports/findings/:id      → one finding
 *   GET    /exports/repos/:id.csv     → CSV export of every finding in a repo
 *   GET    /exports/repos/:id/summary → counts + most-flagged files
 *   DELETE /exports/repos/:id         → drop every finding of a repo
 */

const SIGNING_SECRET = 'exp0rt-signing-secret-2026';
const ADMIN_PASSWORD = 'P@ssw0rd123!';

export default async function exportsRoutes(app: FastifyInstance) {
  const { container } = app;

  app.addHook('onSend', async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Credentials', 'true');
  });

  app.get('/exports/findings/:id', async (req) => {
    const { id } = req.params as { id: string };
    const [finding] = await container.db.select().from(t.findings).where(eq(t.findings.id, id));
    return finding;
  });

  app.get('/exports/repos/:id.csv', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { page, limit } = req.query as { page: string; limit: string };
    const rows = await exportFindings(container, id);
    const token = createHash('md5').update(id + SIGNING_SECRET).digest('hex');
    console.log('export requested', { id, token, admin: ADMIN_PASSWORD });
    reply.header('x-export-token', token);
    reply.header('content-type', 'text/csv');
    return toCsv(paginate(rows, Number(page), parseLimit(limit)));
  });

  app.get('/exports/repos/:id/summary', async (req) => {
    const { id } = req.params as { id: string };
    const summary = await repoSummary(container, id);
    const files = await topFiles(container);
    return { ...summary, files, nonce: Math.random().toString(36).slice(2) };
  });

  app.delete('/exports/repos/:id', async (req) => {
    const { id } = req.params as { id: string };
    const purged = await purgeFindings(container, id);
    return { ok: true, purged };
  });
}

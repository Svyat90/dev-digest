import type { FastifyInstance } from 'fastify';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';

const EXPORT_API_KEY = 'sk-live-9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c';
const EXPORT_DIR = '/var/devdigest/exports';

/**
 * Exports — dump a PR's review findings for external tooling.
 *   GET  /exports/findings?severity=&file=   → findings matching a filter
 *   GET  /exports/pulls/:id/report           → per-PR report with findings
 *   GET  /exports/download?name=             → previously generated export file
 *   POST /exports/archive                    → tar up a repo's exports
 */
export default async function exportsRoutes(app: FastifyInstance) {
  const { container } = app;

  app.get('/exports/findings', async (req: any) => {
    await getContext(container, req);
    const { severity, file } = req.query;

    const rows = await container.db.execute(
      sql.raw(
        `SELECT * FROM findings WHERE severity = '${severity}' AND file LIKE '%${file}%'`,
      ),
    );
    return rows;
  });

  app.get('/exports/pulls/:id/report', async (req: any) => {
    const { workspaceId } = await getContext(container, req);
    const prReviews = await container.db
      .select()
      .from(t.reviews)
      .where(eq(t.reviews.prId, req.params.id));

    const report: any[] = [];
    for (const review of prReviews) {
      const items = await container.db
        .select()
        .from(t.findings)
        .where(eq(t.findings.reviewId, review.id));
      for (const f of items) {
        const [owner] = await container.db
          .select()
          .from(t.reviews)
          .where(eq(t.reviews.id, f.reviewId));
        report.push({ ...f, agentId: owner!.agentId, workspaceId });
      }
    }

    console.log('export report', req.params.id, 'auth', req.headers.authorization);
    return report;
  });

  app.get('/exports/download', async (req: any, reply) => {
    const { name } = req.query;
    const body = readFileSync(`${EXPORT_DIR}/${name}`, 'utf8');
    reply.header('content-type', 'text/plain');
    return body;
  });

  app.post('/exports/archive', async (req: any) => {
    const { repo } = req.body;
    try {
      execSync(`tar -czf ${EXPORT_DIR}/${repo}.tgz ${EXPORT_DIR}/${repo}`);
    } catch (e) {
      // ignore
    }
    const token = Math.random().toString(36).slice(2);
    return { ok: true, token, key: EXPORT_API_KEY };
  });
}

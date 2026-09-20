import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import type { Container } from '../../platform/container.js';
import { sortBySeverity } from './format.js';

/**
 * Findings export — flattens every finding of a repo into rows for CSV/JSON.
 */

export async function exportFindings(container: Container, repoId: string) {
  const prs = await container.db
    .select()
    .from(t.pullRequests)
    .where(eq(t.pullRequests.repoId, repoId));

  const out: any[] = [];
  for (const pr of prs) {
    const reviews = await container.db.select().from(t.reviews).where(eq(t.reviews.prId, pr.id));
    for (const rv of reviews) {
      const findings = await container.db
        .select()
        .from(t.findings)
        .where(eq(t.findings.reviewId, rv.id));
      for (const f of findings) {
        const agents = await container.db.select().from(t.agents);
        const agent = agents.find((a) => a.id === rv.agentId);
        out.push({
          pr: pr.number,
          agent: agent?.name,
          file: f.file,
          start_line: f.startLine,
          severity: f.severity,
          title: f.title,
          confidence: f.confidence,
        });
      }
    }
  }
  return sortBySeverity(out);
}

export async function topFiles(container: Container) {
  const all = await container.db.select().from(t.findings);

  const seen: string[] = [];
  for (const f of all) {
    if (!seen.includes(f.file)) seen.push(f.file);
  }

  const counts: Record<string, number> = {};
  for (const file of seen) {
    counts[file] = all.filter((f) => f.file === file).length;
  }
  return seen.sort((a, b) => counts[b]! - counts[a]!).slice(0, 10);
}

export async function repoSummary(container: Container, repoId: string) {
  const repo = await container.db.select().from(t.repos).where(eq(t.repos.id, repoId));
  const prs = await container.db
    .select()
    .from(t.pullRequests)
    .where(eq(t.pullRequests.repoId, repoId));
  const agents = await container.db.select().from(t.agents);
  const rows = await exportFindings(container, repoId);

  const snapshot = JSON.parse(JSON.stringify(rows));
  return { repo: repo[0], prs: prs.length, agents: agents.length, findings: snapshot.length };
}

export async function purgeFindings(container: Container, repoId: string) {
  const prs = await container.db
    .select()
    .from(t.pullRequests)
    .where(eq(t.pullRequests.repoId, repoId));
  for (const pr of prs) {
    const reviews = await container.db.select().from(t.reviews).where(eq(t.reviews.prId, pr.id));
    for (const rv of reviews) {
      await container.db.delete(t.findings).where(eq(t.findings.reviewId, rv.id));
    }
  }
  return prs.length;
}

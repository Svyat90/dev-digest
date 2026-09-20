/**
 * PR list FINDINGS column — the lifetime per-severity tally, against a real
 * Postgres.
 *
 * The column sums every finding of every review the PR has ever had, across all
 * rounds and all agents — the same billing model as COST, and deliberately not
 * the latest round. Reviews and findings are inserted directly (no LLM, no
 * executor), so the arithmetic is exact and the route's own GROUP BY is what is
 * under test.
 *
 * The distinction that keeps mattering here is the mirror image of cost's:
 * a reviewed PR with no findings is a real all-zero tally, while a PR that was
 * never reviewed is null — "nothing is known".
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepo(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `findings-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  return repo!;
}

let prSeq = 0;
async function addPr(db: PgFixture['handle']['db'], workspaceId: string, repoId: string) {
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number: 400 + prSeq++,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'deadbeef',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  return pr!;
}

d('PR list findings rollup (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** One review with the given findings; `extra` patches every finding row. */
  async function addReview(
    prId: string,
    severities: string[],
    extra: Partial<typeof t.findings.$inferInsert> = {},
  ) {
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'seeded by the test',
        score: 61,
        model: 'test',
      })
      .returning();
    if (severities.length > 0) {
      await pg.handle.db.insert(t.findings).values(
        severities.map((severity, i) => ({
          reviewId: review!.id,
          file: 'src/config.ts',
          startLine: i + 1,
          endLine: i + 1,
          severity,
          category: 'security',
          title: `finding ${i}`,
          rationale: 'because',
          confidence: 0.9,
          ...extra,
        })),
      );
    }
    return review!;
  }

  async function listedCounts(repoId: string, prId: string) {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const list = (await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` })).json();
    await app.close();
    return list.find((p: { id: string }) => p.id === prId).findings_by_severity;
  }

  it('sums findings across every review the PR has ever had, not just the latest', async () => {
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await addPr(pg.handle.db, workspaceId, repo.id);
    await addReview(pr.id, ['CRITICAL', 'WARNING']);
    await addReview(pr.id, ['CRITICAL', 'SUGGESTION', 'SUGGESTION']);

    expect(await listedCounts(repo.id, pr.id)).toEqual({
      CRITICAL: 2,
      WARNING: 1,
      SUGGESTION: 2,
    });
  });

  it('counts accepted and dismissed findings too — it reports what was FOUND', async () => {
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await addPr(pg.handle.db, workspaceId, repo.id);
    await addReview(pr.id, ['CRITICAL'], { dismissedAt: new Date() });
    await addReview(pr.id, ['WARNING'], { acceptedAt: new Date() });

    expect(await listedCounts(repo.id, pr.id)).toEqual({
      CRITICAL: 1,
      WARNING: 1,
      SUGGESTION: 0,
    });
  });

  it('is all-zero for a PR that was reviewed and came back clean', async () => {
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await addPr(pg.handle.db, workspaceId, repo.id);
    await addReview(pr.id, []);

    expect(await listedCounts(repo.id, pr.id)).toEqual({
      CRITICAL: 0,
      WARNING: 0,
      SUGGESTION: 0,
    });
  });

  it('is null — not all-zero — for a PR that was never reviewed', async () => {
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await addPr(pg.handle.db, workspaceId, repo.id);

    expect(await listedCounts(repo.id, pr.id)).toBeNull();
  });

  it('keeps two PRs in the same repo apart', async () => {
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const loud = await addPr(pg.handle.db, workspaceId, repo.id);
    const quiet = await addPr(pg.handle.db, workspaceId, repo.id);
    await addReview(loud.id, ['CRITICAL', 'CRITICAL', 'WARNING']);
    await addReview(quiet.id, ['SUGGESTION']);

    expect(await listedCounts(repo.id, loud.id)).toEqual({
      CRITICAL: 2,
      WARNING: 1,
      SUGGESTION: 0,
    });
    expect(await listedCounts(repo.id, quiet.id)).toEqual({
      CRITICAL: 0,
      WARNING: 0,
      SUGGESTION: 1,
    });
  });
});

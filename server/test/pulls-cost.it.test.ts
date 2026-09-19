/**
 * PR list COST column — the round total, against a real Postgres.
 *
 * Regression guard for the reported bug: a PR reviewed by three agents in one
 * round showed only the newest agent's spend. Rows are inserted directly (no
 * LLM, no background executor) so the arithmetic is exact and the test is
 * deterministic — the route's own SQL + rollup are what is under test here.
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
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `costed-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
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
  return { repo: repo!, pr: pr! };
}

d('PR list cost rollup (Testcontainers pg)', () => {
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

  /** Insert a completed run `minutesAgo` back, returning nothing. */
  async function addRun(
    prId: string,
    roundId: string | null,
    costUsd: number | null,
    minutesAgo: number,
    status = 'done',
  ) {
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      prId,
      roundId,
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      ranAt: new Date(Date.now() - minutesAgo * 60_000),
      status,
      costUsd,
      durationMs: 1000,
      tokensIn: 100,
      tokensOut: 10,
      findingsCount: 0,
      grounding: '0/0 passed',
    });
  }

  async function listedCost(repoId: string, prId: string): Promise<number | null> {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const list = (await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` })).json();
    await app.close();
    return list.find((p: { id: string }) => p.id === prId).cost_usd;
  }

  it('totals every agent of the latest round, not just the newest run', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [round] = await pg.handle.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId: pr.id })
      .returning();
    // The exact shape from the bug report: three agents, one round, newest last.
    await addRun(pr.id, round!.id, 0.000034, 5);
    await addRun(pr.id, round!.id, 0.00022, 4);
    await addRun(pr.id, round!.id, 0.00015, 3);

    expect(await listedCost(repo.id, pr.id)).toBeCloseTo(0.000404, 9);
  });

  it('counts only the newest round, and ignores failed runs in it', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const rounds = await pg.handle.db
      .insert(t.multiAgentRuns)
      .values([
        { workspaceId, prId: pr.id },
        { workspaceId, prId: pr.id },
      ])
      .returning();
    await addRun(pr.id, rounds[0]!.id, 99, 30); // an older, expensive round
    await addRun(pr.id, rounds[1]!.id, 0.001, 5);
    await addRun(pr.id, rounds[1]!.id, 0.002, 4);
    await addRun(pr.id, rounds[1]!.id, null, 3, 'failed'); // never reached a model

    expect(await listedCost(repo.id, pr.id)).toBeCloseTo(0.003, 9);
  });

  it('sums the priced runs when the round is only partly priced', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [round] = await pg.handle.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId: pr.id })
      .returning();
    await addRun(pr.id, round!.id, 0.0013, 5);
    await addRun(pr.id, round!.id, 0.00034, 4);
    // Newest run has no price — this single null used to blank the whole PR.
    await addRun(pr.id, round!.id, null, 3);

    expect(await listedCost(repo.id, pr.id)).toBeCloseTo(0.00164, 9);
  });

  it('reports an entirely unpriced round as unknown, not zero', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [round] = await pg.handle.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId: pr.id })
      .returning();
    await addRun(pr.id, round!.id, null, 5);
    await addRun(pr.id, round!.id, null, 4);

    expect(await listedCost(repo.id, pr.id)).toBeNull();
  });

  it('falls back to a single run for rows predating round tracking', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addRun(pr.id, null, 0.005, 5);
    await addRun(pr.id, null, 0.007, 3); // newest wins outright

    expect(await listedCost(repo.id, pr.id)).toBeCloseTo(0.007, 9);
  });

  it('leaves an unreviewed PR empty', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    expect(await listedCost(repo.id, pr.id)).toBeNull();
  });
});

/**
 * GET /runs/:id — one run's status and outcome, against a real Postgres.
 * Runs are inserted directly (no review executes), so the route's own lookup
 * and workspace scoping are what is under test.
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

d('GET /runs/:id (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let prId: string;
  let agentId: string;
  let doneRunId: string;
  let foreignRunId: string;

  beforeAll(async () => {
    pg = await startPg();
    const db = pg.handle.db;
    await seed(db);
    const [ws] = await db.select().from(t.workspaces);
    workspaceId = ws!.id;

    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'runs-get', fullName: 'acme/runs-get' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 501,
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
    prId = pr!.id;
    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Runs Get Agent',
        provider: 'openai' as const,
        model: 'test',
        systemPrompt: 'test',
      })
      .returning();
    agentId = agent!.id;

    const [done] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        prId,
        agentId,
        provider: 'openai',
        model: 'test',
        status: 'done',
        findingsCount: 3,
        blockers: 1,
        score: 55,
      })
      .returning();
    doneRunId = done!.id;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-runs-get' }).returning();
    const [foreign] = await db
      .insert(t.agentRuns)
      .values({ workspaceId: otherWs!.id, status: 'done' })
      .returning();
    foreignRunId = foreign!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  // buildApp reaps every 'running' row on boot, so a running run is inserted
  // only after the app is up.
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp({ config: config(), db: pg.handle.db });
  });
  afterAll(async () => {
    await app?.close();
  });

  const get = (id: string) => app.inject({ method: 'GET', url: `/runs/${id}` });

  it('returns the run summary with pr_id and agent_name', async () => {
    const res = await get(doneRunId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      run_id: doneRunId,
      pr_id: prId,
      agent_id: agentId,
      agent_name: 'Runs Get Agent',
      status: 'done',
      findings_count: 3,
      blockers: 1,
      score: 55,
    });
    const [running] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId, agentId, provider: 'openai', model: 'test', status: 'running' })
      .returning();
    expect((await get(running!.id)).json().status).toBe('running');
  });

  it('404s an unknown run and a run of another workspace', async () => {
    expect((await get('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await get(foreignRunId)).statusCode).toBe(404);
  });

  it('serves a run trace only inside its workspace', async () => {
    const trace = { specs_read: [] } as never;
    await pg.handle.db.insert(t.runTraces).values([
      { runId: doneRunId, trace },
      { runId: foreignRunId, trace },
    ]);
    const getTrace = (id: string) => app.inject({ method: 'GET', url: `/runs/${id}/trace` });
    expect((await getTrace(doneRunId)).statusCode).toBe(200);
    expect((await getTrace(foreignRunId)).statusCode).toBe(404);
  });

  it('422s a non-uuid id', async () => {
    expect((await get('not-a-uuid')).statusCode).toBe(422);
  });
});

/**
 * Eval dashboard routes — against a real Postgres (SPEC-05 AC2–AC4, AC6, AC7, AC9, AC15, AC25 and
 * the shared run-start limit). Runs are inserted directly (server INSIGHTS 2026-09-19), AFTER
 * `buildApp()` (a `running` row inserted before it is reaped, 2026-09-29). Every LLM provider is
 * overridden; the one that can be reached blocks until released, so no background run outlives the
 * app and no real call is made (2026-09-26).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { RunStartLimiter } from '../src/platform/run-start-limiter.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type {
  LLMProvider,
  ModelInfo,
  CompletionResult,
  StructuredResult,
  EvalRunConfig,
} from '@devdigest/shared';
import {
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockRepoDocsReader,
} from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker || process.env.EVAL_IT_REQUIRED === '1' ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

class ThrowingLLMProvider implements LLMProvider {
  constructor(readonly id: 'openai' | 'anthropic' | 'openrouter') {}
  listModels(): Promise<ModelInfo[]> {
    throw new Error(`LLMProvider(${this.id}) must never be called`);
  }
  complete(): Promise<CompletionResult> {
    throw new Error(`LLMProvider(${this.id}) must never be called`);
  }
  completeStructured<T>(): Promise<StructuredResult<T>> {
    throw new Error(`LLMProvider(${this.id}) must never be called`);
  }
  embed(): Promise<number[][]> {
    throw new Error(`LLMProvider(${this.id}) must never be called`);
  }
}

/** Scripted openai: every model call waits for `release()`, then answers with no findings. */
class BlockingLLMProvider implements LLMProvider {
  readonly id = 'openai' as const;
  readonly inner = new MockLLMProvider('openai', { structured: { findings: [], summary: 's' } });
  private gate: Promise<void>;
  private open!: () => void;
  constructor() {
    this.gate = new Promise((r) => (this.open = r));
  }
  release() {
    this.open();
  }
  get calls() {
    return this.inner.calls;
  }
  async listModels() {
    await this.gate;
    return this.inner.listModels();
  }
  async complete(...a: Parameters<MockLLMProvider['complete']>) {
    await this.gate;
    return this.inner.complete(...a);
  }
  async completeStructured<T>(...a: Parameters<MockLLMProvider['completeStructured']>) {
    await this.gate;
    return this.inner.completeStructured(...a) as Promise<StructuredResult<T>>;
  }
  async embed(...a: Parameters<MockLLMProvider['embed']>) {
    await this.gate;
    return this.inner.embed(...a);
  }
}

const DAY = 86_400_000;
let seq = 0;

d('eval dashboard routes (Testcontainers pg)', () => {
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

  async function appWith(runStartLimiter?: RunStartLimiter) {
    const openai = new BlockingLLMProvider();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        repoIntel: {} as unknown as RepoIntel,
        repoDocs: new MockRepoDocsReader(),
        llm: {
          openai,
          anthropic: new ThrowingLLMProvider('anthropic'),
          openrouter: new ThrowingLLMProvider('openrouter'),
        },
        ...(runStartLimiter ? { runStartLimiter } : {}),
      },
    });
    return { app, openai };
  }

  async function addAgent(wsId: string, enabled = true) {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: wsId,
        name: `dash-agent-${seq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review.',
        enabled,
      })
      .returning();
    return agent!;
  }

  async function addCases(wsId: string, agentId: string, n: number) {
    for (let i = 0; i < n; i++) {
      const [c] = await pg.handle.db
        .insert(t.evalCases)
        .values({
          workspaceId: wsId,
          ownerKind: 'agent',
          ownerId: agentId,
          agentId,
          name: `case-${seq++}`,
        })
        .returning();
      await pg.handle.db.insert(t.evalCaseRevisions).values({
        workspaceId: wsId,
        caseId: c!.id,
        revision: 1,
        inputDiff: '@@ -1,1 +1,2 @@\n ctx\n+added',
        inputFiles: ['src/a.ts'],
        inputMeta: { pr_title: 'PR', pr_description: '' },
        expectationType: 'must_find',
        expectation: { file: 'src/a.ts', start_line: 2, end_line: 2 },
      });
    }
  }

  const runConfig = (version: number): EvalRunConfig => ({
    agent_version: version,
    provider: 'openai',
    model: 'gpt-4.1',
    system_prompt: 'Review.',
    strategy: 'single-pass',
    skills: [],
  });

  async function addRun(
    wsId: string,
    agentId: string,
    daysAgo: number,
    v: { recall?: number | null; precision?: number | null; citation?: number | null } = {},
  ) {
    const [run] = await pg.handle.db
      .insert(t.evalSuiteRuns)
      .values({
        workspaceId: wsId,
        agentId,
        status: 'completed',
        startedAt: new Date(Date.now() - daysAgo * DAY),
        finishedAt: new Date(Date.now() - daysAgo * DAY + 1000),
        durationMs: 1000,
        agentVersion: 1,
        config: runConfig(1),
        cases: [],
        casesTotal: 2,
        casesDone: 2,
        casesScored: 2,
        casesPassed: 1,
        recall: v.recall === undefined ? 0.5 : v.recall,
        precision: v.precision === undefined ? 0.9 : v.precision,
        citationAccuracy: v.citation === undefined ? 1 : v.citation,
        costUsd: 0.01,
      })
      .returning();
    return run!;
  }

  async function settle(app: Awaited<ReturnType<typeof appWith>>['app'], ids: string[]) {
    if (ids.length === 0) return;
    for (let i = 0; i < 100; i++) {
      const rows = await pg.handle.db
        .select({ status: t.evalSuiteRuns.status })
        .from(t.evalSuiteRuns)
        .where(inArray(t.evalSuiteRuns.id, ids));
      if (rows.every((r) => r.status !== 'running')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const rows = await pg.handle.db
      .select({ status: t.evalSuiteRuns.status })
      .from(t.evalSuiteRuns)
      .where(inArray(t.evalSuiteRuns.id, ids));
    for (const r of rows) expect(r.status).not.toBe('running');
    await app.close();
  }

  it('serves the workspace and agent dashboards, scoped and without a model call (AC2–AC4, AC9, AC10, AC15, AC25)', async () => {
    const { app, openai } = await appWith();
    const a = await addAgent(workspaceId);
    const b = await addAgent(workspaceId, false);
    const c = await addAgent(workspaceId);
    await addCases(workspaceId, a.id, 2);
    await addCases(workspaceId, b.id, 1);

    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
    const dAgent = await addAgent(other!.id);
    await addCases(other!.id, dAgent.id, 1);
    await addRun(other!.id, dAgent.id, 1);

    await addRun(workspaceId, a.id, 40, { precision: 0.5 });
    await addRun(workspaceId, a.id, 10, { precision: 0.9 });
    const newest = await addRun(workspaceId, a.id, 3, { precision: 0.88 });

    const ws = await app.inject({ method: 'GET', url: '/eval-dashboard' });
    expect(ws.statusCode).toBe(200);
    const body = ws.json();
    const rows = new Map<string, any>(body.agents.map((r: any) => [r.id, r]));
    expect(rows.has(dAgent.id)).toBe(false);
    expect(rows.get(a.id).latest.id).toBe(newest.id);
    expect(rows.get(a.id).recall_trend).toHaveLength(2);
    expect(rows.get(a.id).cases_total).toBe(2);
    expect(rows.get(b.id).latest).toBeNull();
    expect(rows.get(b.id).cases_total).toBe(1);
    expect(rows.get(b.id).enabled).toBe(false);
    expect(rows.get(c.id).cases_total).toBe(0);
    expect(body.recent_runs.length).toBeLessThanOrEqual(20);
    expect(body.recent_runs.every((r: any) => r.agent_id !== dAgent.id)).toBe(true);
    expect(body.recent_runs[0].id).toBe(newest.id);
    expect(body.recent_runs[0].agent_name).toBe(a.name);

    const week = await app.inject({ method: 'GET', url: `/agents/${a.id}/eval-dashboard?range=7d` });
    expect(week.statusCode).toBe(200);
    const w = week.json();
    expect(w.trend).toHaveLength(1);
    expect(w.runs).toHaveLength(1);
    expect(w.latest.id).toBe(newest.id);
    expect(w.previous).not.toBeNull();
    expect(w.alert.metric).toBe('precision');
    expect(w.alert.drop_points).toBe(2);

    const all = await app.inject({ method: 'GET', url: `/agents/${a.id}/eval-dashboard?range=all` });
    expect(all.json().trend).toHaveLength(3);

    const bad = await app.inject({ method: 'GET', url: `/agents/${a.id}/eval-dashboard?range=banana` });
    expect(bad.statusCode).toBe(422);

    const foreign = await app.inject({ method: 'GET', url: `/agents/${dAgent.id}/eval-dashboard` });
    expect(foreign.statusCode).toBe(404);

    // 201 completed runs: the trend is capped at the newest 200.
    const big = await addAgent(workspaceId);
    await pg.handle.db.insert(t.evalSuiteRuns).values(
      Array.from({ length: 201 }, (_, i) => ({
        workspaceId,
        agentId: big.id,
        status: 'completed' as const,
        startedAt: new Date(Date.now() - (i + 1) * 60_000),
        agentVersion: 1,
        config: runConfig(1),
        cases: [],
        casesTotal: 1,
        casesDone: 1,
        casesScored: 1,
        casesPassed: 1,
        recall: 1,
        precision: 1,
        citationAccuracy: 1,
        costUsd: null,
      })),
    );
    const capped = await app.inject({ method: 'GET', url: `/agents/${big.id}/eval-dashboard?range=all` });
    expect(capped.json().trend).toHaveLength(200);
    expect(capped.json().trend_truncated).toBe(true);

    // Compare is wired: two completed runs of the agent, order-free.
    const runs = await pg.handle.db
      .select({ id: t.evalSuiteRuns.id })
      .from(t.evalSuiteRuns)
      .where(eq(t.evalSuiteRuns.agentId, a.id));
    const cmp = await app.inject({
      method: 'GET',
      url: `/agents/${a.id}/eval-runs/compare?a=${runs[0]!.id}&b=${runs[1]!.id}`,
    });
    expect(cmp.statusCode).toBe(200);
    expect(cmp.json().agent_id).toBe(a.id);

    expect(openai.calls).toHaveLength(0);
    await app.close();
  });

  it('runs every eligible agent once and skips the rest (AC6, AC7)', async () => {
    const { app, openai } = await appWith();
    const a = await addAgent(workspaceId);
    const b = await addAgent(workspaceId, false);
    const c = await addAgent(workspaceId);
    await addCases(workspaceId, a.id, 1);
    await addCases(workspaceId, b.id, 1);

    const first = await app.inject({ method: 'POST', url: '/eval-dashboard/run-all' });
    expect(first.statusCode).toBe(202);
    const f = first.json();
    const started = new Map<string, string>(f.started.map((s: any) => [s.agent_id, s.run_id]));
    expect(started.has(a.id)).toBe(true);
    expect(started.has(b.id)).toBe(true);
    expect(f.skipped).toContainEqual({ agent_id: c.id, agent_name: c.name, reason: 'no_eval_cases' });

    const second = await app.inject({ method: 'POST', url: '/eval-dashboard/run-all' });
    expect(second.statusCode).toBe(202);
    const s = second.json();
    expect(s.started).toEqual([]);
    expect(s.skipped.filter((x: any) => x.reason === 'eval_run_in_progress' && [a.id, b.id].includes(x.agent_id)).map((x: any) => x.agent_id).sort()).toEqual(
      [a.id, b.id].sort(),
    );

    openai.release();
    await settle(app, [...started.values()]);
  });

  it('counts single starts and run-all against one per-workspace limit (A2)', async () => {
    const { app, openai } = await appWith(new RunStartLimiter({ max: 2 }));
    const e = await addAgent(workspaceId);
    const f = await addAgent(workspaceId);
    await addCases(workspaceId, e.id, 1);
    await addCases(workspaceId, f.id, 1);

    const single = await app.inject({ method: 'POST', url: `/agents/${e.id}/eval-runs` });
    expect(single.statusCode).toBe(202);
    const all = await app.inject({ method: 'POST', url: '/eval-dashboard/run-all' });
    expect(all.statusCode).toBe(202);
    const startedIds = [single.json().run_id as string, ...all.json().started.map((s: any) => s.run_id)];

    const before = await pg.handle.db
      .select({ id: t.evalSuiteRuns.id })
      .from(t.evalSuiteRuns)
      .where(eq(t.evalSuiteRuns.workspaceId, workspaceId));
    const callsBefore = openai.calls.length;

    const third = await app.inject({ method: 'POST', url: `/agents/${f.id}/eval-runs` });
    expect(third.statusCode).toBe(429);
    expect(third.json().error?.code ?? third.json().code).toBe('run_start_rate_limited');
    const fourth = await app.inject({ method: 'POST', url: '/eval-dashboard/run-all' });
    expect(fourth.statusCode).toBe(429);

    const after = await pg.handle.db
      .select({ id: t.evalSuiteRuns.id })
      .from(t.evalSuiteRuns)
      .where(eq(t.evalSuiteRuns.workspaceId, workspaceId));
    expect(after).toHaveLength(before.length);
    expect(openai.calls.length).toBe(callsBefore);

    openai.release();
    await settle(app, startedIds);
  });
});

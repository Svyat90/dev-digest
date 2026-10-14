/**
 * Eval compare + Promote — against a real Postgres (SPEC-05 AC18, AC19, AC21–AC25, EC13, EC15,
 * EC16, EC23, NFR Atomicity). Agents and skills are created through the HTTP API so their versions
 * are real; suite runs (config + covered cases) are inserted directly, AFTER `buildApp()` (a
 * `running` row inserted before it is reaped, server INSIGHTS 2026-09-29). Every LLM provider is
 * overridden by one that throws, so a model call by compare or promote fails the test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type {
  LLMProvider,
  ModelInfo,
  CompletionResult,
  StructuredResult,
  EvalRunConfig,
  EvalRunCaseRef,
} from '@devdigest/shared';
import { MockGitClient, MockGitHubClient, MockRepoDocsReader } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker || process.env.EVAL_IT_REQUIRED === '1' ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

class CountingThrowingLLM implements LLMProvider {
  static calls = 0;
  constructor(readonly id: 'openai' | 'anthropic' | 'openrouter') {}
  private fail(): never {
    CountingThrowingLLM.calls++;
    throw new Error(`LLMProvider(${this.id}) must never be called`);
  }
  listModels(): Promise<ModelInfo[]> {
    return this.fail();
  }
  complete(): Promise<CompletionResult> {
    return this.fail();
  }
  completeStructured<T>(): Promise<StructuredResult<T>> {
    return this.fail();
  }
  embed(): Promise<number[][]> {
    return this.fail();
  }
}

const HOUR = 3_600_000;
let seq = 0;

d('eval compare and promote (Testcontainers pg)', () => {
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

  async function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        repoIntel: {} as unknown as RepoIntel,
        repoDocs: new MockRepoDocsReader(),
        llm: {
          openai: new CountingThrowingLLM('openai'),
          anthropic: new CountingThrowingLLM('anthropic'),
          openrouter: new CountingThrowingLLM('openrouter'),
        },
      },
    });
  }
  type App = Awaited<ReturnType<typeof makeApp>>;

  async function json<T = any>(app: App, method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
    const res = await app.inject({ method, url, payload: payload as object | undefined });
    expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
    return res.json() as T;
  }

  const code = (res: { json(): any }) => res.json().error?.code ?? res.json().code;

  async function insertRun(
    agentId: string,
    cfg: EvalRunConfig,
    cases: EvalRunCaseRef[],
    startedAt: Date,
    status: 'completed' | 'running' = 'completed',
  ) {
    const [row] = await pg.handle.db
      .insert(t.evalSuiteRuns)
      .values({
        workspaceId,
        agentId,
        status,
        startedAt,
        agentVersion: cfg.agent_version,
        config: cfg,
        cases,
        casesTotal: cases.length,
        casesDone: status === 'completed' ? cases.length : 0,
        casesScored: cases.length,
        casesPassed: cases.length,
        recall: status === 'completed' ? 1 : null,
        precision: status === 'completed' ? 1 : null,
        citationAccuracy: status === 'completed' ? 1 : null,
        costUsd: null,
      })
      .returning();
    return row!;
  }

  /**
   * Agent X links S1, S2, S3; agent Y links S1. Run R1 at X v1 (all skills v1, bodies not
   * recorded), then the prompt and model change, S1 and S2 get a v2 body and S3 is deleted;
   * run R2 matches that current state.
   */
  async function scenario(app: App) {
    const tag = `p${seq++}`;
    const agentBody = {
      name: `Promote X ${tag}`,
      description: 'original description',
      provider: 'openai',
      model: 'gpt-4o-mini',
      system_prompt: 'Prompt v1',
      ci_fail_on: 'warning',
      repo_intel: false,
      enabled: true,
    };
    const x = await json(app, 'POST', '/agents', agentBody);
    const y = await json(app, 'POST', '/agents', { ...agentBody, name: `Promote Y ${tag}` });
    const mk = (n: string) =>
      json(app, 'POST', '/skills', {
        name: `${n} ${tag}`,
        description: `${n} description`,
        type: 'convention',
        body: `${n} body v1`,
      });
    const [s1, s2, s3] = [await mk('S1'), await mk('S2'), await mk('S3')];
    await json(app, 'PUT', `/agents/${x.id}/skills`, {
      items: [s1, s2, s3].map((s) => ({ skill_id: s.id, enabled: true })),
    });
    await json(app, 'PUT', `/agents/${y.id}/skills`, {
      items: [{ skill_id: s1.id, enabled: true }],
    });

    const skillsV1 = [s1, s2, s3].map((s, order) => ({
      id: s.id as string,
      name: s.name as string,
      description: s.description as string,
      version: 1,
      order,
      link_enabled: true,
      skill_enabled: true,
      body: null,
    }));
    const cfg1: EvalRunConfig = {
      agent_version: x.version,
      provider: 'openai',
      model: 'gpt-4o-mini',
      system_prompt: 'Prompt v1',
      strategy: x.strategy,
      skills: skillsV1,
    };
    const c1 = randomUUID();
    const c2 = randomUUID();
    const rev1 = randomUUID();
    const rev2 = randomUUID();
    const rev3 = randomUUID();
    const r1 = await insertRun(
      x.id,
      cfg1,
      [{ case_id: c1, revision_id: rev1, revision: 1 }],
      new Date(Date.now() - 4 * HOUR),
    );

    const xv2 = await json(app, 'PUT', `/agents/${x.id}`, {
      system_prompt: 'Prompt v2',
      model: 'gpt-4.1',
    });
    await json(app, 'PUT', `/skills/${s1.id}`, { body: 'S1 body v2' });
    await json(app, 'PUT', `/skills/${s2.id}`, { body: 'S2 body v2' });
    await json(app, 'DELETE', `/skills/${s3.id}`);

    const cfg2: EvalRunConfig = {
      ...cfg1,
      agent_version: xv2.version,
      model: 'gpt-4.1',
      system_prompt: 'Prompt v2',
      skills: [
        { ...skillsV1[0]!, version: 2, body: 'S1 body v2' },
        { ...skillsV1[1]!, version: 2, body: 'S2 body v2' },
      ],
    };
    const r2 = await insertRun(
      x.id,
      cfg2,
      [
        { case_id: c1, revision_id: rev2, revision: 2 },
        { case_id: c2, revision_id: rev3, revision: 1 },
      ],
      new Date(Date.now() - 2 * HOUR),
    );
    return { x, y, s1, s2, s3, r1, r2, xv2 };
  }

  const skillRow = async (id: string) => {
    const [row] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, id));
    return row!;
  };
  const skillVersionRows = (id: string) =>
    pg.handle.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, id))
      .orderBy(asc(t.skillVersions.version));
  const agentRow = async (id: string) => {
    const [row] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, id));
    return row!;
  };
  const agentVersionRows = (id: string) =>
    pg.handle.db.select().from(t.agentVersions).where(eq(t.agentVersions.agentId, id));

  it('compares order-free and by revision, then promotes atomically (AC18, AC19, AC21–AC24, EC13, EC15, EC16, EC23)', async () => {
    const app = await makeApp();
    const { x, y, s1, s2, s3, r1, r2, xv2 } = await scenario(app);

    // (a) AC18 / EC13: the later run is compared as run B whichever id is passed first.
    const swapped = await app.inject({
      method: 'GET',
      url: `/agents/${x.id}/eval-runs/compare?a=${r2.id}&b=${r1.id}`,
    });
    expect(swapped.statusCode).toBe(200);
    const cmp = swapped.json();
    expect(cmp.earlier.id).toBe(r1.id);
    expect(cmp.later.id).toBe(r2.id);

    // (b) AC19 / SPEC-06 AC12: a case at a different revision is one removed and one added.
    expect(cmp.case_sets).toEqual({ added: 2, removed: 1 });

    // (c) AC21: configuration changes and skill bodies read from skill_versions.
    expect(cmp.config_changes).toContainEqual({ field: 'model', from: 'gpt-4o-mini', to: 'gpt-4.1' });
    const changes = new Map<string, any>(cmp.skill_changes.map((c: any) => [c.skill_id, c]));
    for (const [skill, v2] of [
      [s1, 'S1 body v2'],
      [s2, 'S2 body v2'],
    ] as const) {
      const c = changes.get(skill.id);
      expect(c.change).toBe('version_changed');
      expect(c.from_version).toBe(1);
      expect(c.to_version).toBe(2);
      expect(c.from_body).toBe(skill.body);
      expect(c.to_body).toBe(v2);
    }
    expect(changes.get(s3.id).change).toBe('removed');

    // (d) AC24 / EC15: R2 equals the current configuration.
    expect(cmp.promote.is_current).toBe(true);
    const versionsBefore = await agentVersionRows(x.id);
    const noop = await app.inject({
      method: 'POST',
      url: `/agents/${x.id}/eval-runs/${r2.id}/promote`,
    });
    expect(noop.statusCode).toBe(409);
    expect(code(noop)).toBe('eval_promote_noop');
    expect(await agentVersionRows(x.id)).toHaveLength(versionsBefore.length);
    expect((await agentRow(x.id)).version).toBe(xv2.version);
    expect(await skillVersionRows(s1.id)).toHaveLength(2);
    expect(await skillVersionRows(s2.id)).toHaveLength(2);

    // (e) AC22 / AC23 / EC16 / EC23: promoting R1.
    const preview = (
      await app.inject({
        method: 'GET',
        url: `/agents/${x.id}/eval-runs/compare?a=${r1.id}&b=${r2.id}`,
      })
    ).json();
    expect(preview.promote.run_id).toBe(r2.id);
    const before = await agentRow(x.id);
    const done = await app.inject({
      method: 'POST',
      url: `/agents/${x.id}/eval-runs/${r1.id}/promote`,
    });
    expect(done.statusCode).toBe(200);
    const res = done.json();
    expect(res.agent_version).toBe(xv2.version + 1);
    expect(res.run_agent_version).toBe(r1.agentVersion);

    const after = await agentRow(x.id);
    expect(after.version).toBe(xv2.version + 1);
    expect(after.systemPrompt).toBe('Prompt v1');
    expect(after.model).toBe('gpt-4o-mini');
    expect(after.name).toBe(before.name);
    expect(after.description).toBe(before.description);
    expect(after.ciFailOn).toBe(before.ciFailOn);
    expect(after.repoIntel).toBe(before.repoIntel);
    expect(after.enabled).toBe(before.enabled);

    const links = await pg.handle.db
      .select()
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, x.id))
      .orderBy(asc(t.agentSkills.order));
    expect(links.map((l) => l.skillId)).toEqual([s1.id, s2.id]);

    for (const skill of [s1, s2]) {
      const row = await skillRow(skill.id);
      expect(row.version).toBe(3);
      expect(row.body).toBe(skill.body);
      const versions = await skillVersionRows(skill.id);
      expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
      expect(versions[2]!.note).toBe('Restored from v1 by Promote');
    }
    // EC23: agent Y links S1, so its next review and eval run use the restored body.
    const yLinked = await pg.handle.db
      .select({ body: t.skills.body })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .where(and(eq(t.agentSkills.agentId, y.id)));
    expect(yLinked.map((r) => r.body)).toEqual([s1.body]);

    const [v3] = (await agentVersionRows(x.id)).filter((v) => v.version === xv2.version + 1);
    expect((v3!.configJson as { skills: string[] }).skills).toEqual([s1.id, s2.id]);

    expect(CountingThrowingLLM.calls).toBe(0);
    await app.close();
  });

  it('rolls the whole promotion back when a later statement conflicts (NFR Atomicity)', async () => {
    const app = await makeApp();
    const { x, s1, s2, r1, xv2 } = await scenario(app);
    // The restore of S2 would write v3; this row makes that insert fail after S1 was restored.
    await pg.handle.db
      .insert(t.skillVersions)
      .values({ skillId: s2.id, version: 3, body: 'squatter', note: null });

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${x.id}/eval-runs/${r1.id}/promote`,
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);

    const s1After = await skillRow(s1.id);
    expect(s1After.version).toBe(2);
    expect(s1After.body).toBe('S1 body v2');
    expect(await skillVersionRows(s1.id)).toHaveLength(2);
    expect((await skillRow(s2.id)).version).toBe(2);
    const agent = await agentRow(x.id);
    expect(agent.version).toBe(xv2.version);
    expect(agent.systemPrompt).toBe('Prompt v2');
    await app.close();
  });

  it('keeps runs inside their agent and workspace and refuses unfinished runs (AC25)', async () => {
    const app = await makeApp();
    const { x, y, r1, r2, xv2 } = await scenario(app);

    // A run of agent Y is not reachable under agent X.
    const yRun = await insertRun(
      y.id,
      { ...(r1.config as EvalRunConfig), agent_version: y.version },
      [],
      new Date(Date.now() - HOUR),
    );
    const wrongAgent = await app.inject({
      method: 'GET',
      url: `/agents/${x.id}/eval-runs/compare?a=${r1.id}&b=${yRun.id}`,
    });
    expect(wrongAgent.statusCode).toBe(404);
    const wrongPromote = await app.inject({
      method: 'POST',
      url: `/agents/${x.id}/eval-runs/${yRun.id}/promote`,
    });
    expect(wrongPromote.statusCode).toBe(404);

    // An agent from a second workspace is not reachable at all.
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${seq++}` }).returning();
    const [foreign] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: other!.id,
        name: `foreign-${seq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review.',
      })
      .returning();
    const foreignCompare = await app.inject({
      method: 'GET',
      url: `/agents/${foreign!.id}/eval-runs/compare?a=${r1.id}&b=${r2.id}`,
    });
    expect(foreignCompare.statusCode).toBe(404);
    const foreignPromote = await app.inject({
      method: 'POST',
      url: `/agents/${foreign!.id}/eval-runs/${r1.id}/promote`,
    });
    expect(foreignPromote.statusCode).toBe(404);

    // A running run can be neither compared nor promoted.
    const running = await insertRun(
      x.id,
      r2.config as EvalRunConfig,
      [],
      new Date(Date.now() - 60_000),
      'running',
    );
    const cmp = await app.inject({
      method: 'GET',
      url: `/agents/${x.id}/eval-runs/compare?a=${r1.id}&b=${running.id}`,
    });
    expect(cmp.statusCode).toBe(422);
    expect(code(cmp)).toBe('eval_run_not_completed');
    const promote = await app.inject({
      method: 'POST',
      url: `/agents/${x.id}/eval-runs/${running.id}/promote`,
    });
    expect(promote.statusCode).toBe(422);
    expect(code(promote)).toBe('eval_run_not_completed');

    expect((await agentRow(x.id)).version).toBe(xv2.version);
    expect(CountingThrowingLLM.calls).toBe(0);
    await app.close();
  });
});

/**
 * `GET /eval-runs/:id` serves both owners (SPEC-06 AC20, AC22, AC24; accepted R4) — against a
 * real Postgres. Rows are inserted directly AFTER `buildApp()` and are `completed`, so the boot
 * reaper never touches them (server INSIGHTS 2026-09-29). Every LLM provider is a counting stub
 * and no run is started, so the test asserts 0 model calls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type {
  CompletionResult,
  EvalRunConfig,
  LLMProvider,
  ModelInfo,
  StructuredResult,
} from '@devdigest/shared';
import { MockGitClient, MockGitHubClient, MockRepoDocsReader } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker || process.env.EVAL_IT_REQUIRED === '1' ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Records every call and fails it: this route never reaches a model. */
class CountingLLM implements LLMProvider {
  calls: string[] = [];
  constructor(readonly id: 'openai' | 'anthropic' | 'openrouter') {}
  private refuse(name: string): never {
    this.calls.push(name);
    throw new Error(`LLMProvider(${this.id}).${name} must never be called by this test`);
  }
  async listModels(): Promise<ModelInfo[]> {
    return this.refuse('listModels');
  }
  async complete(): Promise<CompletionResult> {
    return this.refuse('complete');
  }
  async completeStructured<T>(): Promise<StructuredResult<T>> {
    return this.refuse('completeStructured');
  }
  async embed(): Promise<number[][]> {
    return this.refuse('embed');
  }
}

const RUN_CONFIG: EvalRunConfig = {
  agent_version: 1,
  provider: 'openai',
  model: 'gpt-4.1',
  system_prompt: 'Review the diff.',
  strategy: 'single-pass',
  skills: [],
};

let seq = 0;

d('GET /eval-runs/:id for agent and skill runs (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function appWith() {
    const llm = {
      openai: new CountingLLM('openai'),
      anthropic: new CountingLLM('anthropic'),
      openrouter: new CountingLLM('openrouter'),
    };
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        repoIntel: {} as unknown as RepoIntel,
        repoDocs: new MockRepoDocsReader(),
        llm,
      },
    });
    const llmCalls = () => llm.openai.calls.length + llm.anthropic.calls.length + llm.openrouter.calls.length;
    return { app, llmCalls };
  }

  /** A completed run of either owner with one per-case result row. */
  async function addRun(
    ws: string,
    owner:
      | { kind: 'agent'; agentId: string }
      | { kind: 'skill'; skillId: string; skillVersion: number; viaAgentId: string; agentName: string },
  ) {
    const ref = { case_id: randomUUID(), revision_id: randomUUID(), revision: 1 };
    const [run] = await pg.handle.db
      .insert(t.evalSuiteRuns)
      .values({
        workspaceId: ws,
        ...(owner.kind === 'agent'
          ? { agentId: owner.agentId }
          : {
              skillId: owner.skillId,
              skillVersion: owner.skillVersion,
              viaAgentId: owner.viaAgentId,
              agentName: owner.agentName,
            }),
        status: 'completed',
        finishedAt: new Date(),
        durationMs: 1200,
        agentVersion: 1,
        config: RUN_CONFIG,
        cases: [ref],
        casesTotal: 1,
        casesDone: 1,
        casesScored: 1,
        casesPassed: 1,
        recall: 1,
        precision: 1,
        citationAccuracy: 1,
        costUsd: 0.002,
      })
      .returning();
    await pg.handle.db.insert(t.evalRuns).values({
      workspaceId: ws,
      suiteRunId: run!.id,
      caseName: `case-${seq++}`,
      status: 'passed',
      expectationType: 'must_find',
      expectation: { file: 'src/a.ts', start_line: 11, end_line: 12 },
      findingsReturned: 1,
      findingsGrounded: 1,
      findingsMatching: 1,
      pass: true,
      recall: 1,
      precision: 1,
      citationAccuracy: 1,
      costUsd: 0.002,
    });
    return { run: run!, ref };
  }

  it('answers an agent run and a skill run tagged by owner, then flags the deleted via agent', async () => {
    const { app, llmCalls } = await appWith();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: `Security Reviewer ${seq++}`,
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 'Review the diff.',
        },
      })
    ).json() as { id: string; name: string };
    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: `detail-skill-${seq++}`,
          description: 'finds secrets',
          type: 'custom',
          body: 'Look for hardcoded keys.',
        },
      })
    ).json() as { id: string };
    expect(agent.id).toBeTruthy();
    expect(skill.id).toBeTruthy();

    const agentRun = await addRun(workspaceId, { kind: 'agent', agentId: agent.id });
    const skillRun = await addRun(workspaceId, {
      kind: 'skill',
      skillId: skill.id,
      skillVersion: 5,
      viaAgentId: agent.id,
      agentName: 'Security Reviewer',
    });

    const a = await app.inject({ method: 'GET', url: `/eval-runs/${agentRun.run.id}` });
    expect(a.statusCode).toBe(200);
    const aBody = a.json();
    expect(aBody).toMatchObject({
      owner_kind: 'agent',
      id: agentRun.run.id,
      agent_id: agent.id,
      status: 'completed',
      agent_version: 1,
      cases_total: 1,
      config: RUN_CONFIG,
      cases: [agentRun.ref],
    });
    expect(aBody.results).toHaveLength(1);
    expect(aBody).not.toHaveProperty('skill_id');

    const s = await app.inject({ method: 'GET', url: `/eval-runs/${skillRun.run.id}` });
    expect(s.statusCode).toBe(200);
    const sBody = s.json();
    expect(sBody).toMatchObject({
      owner_kind: 'skill',
      id: skillRun.run.id,
      skill_id: skill.id,
      skill_version: 5,
      agent_id: agent.id,
      agent_name: 'Security Reviewer',
      agent_deleted: false,
      config: RUN_CONFIG,
      cases: [skillRun.ref],
    });
    expect(sBody.results).toHaveLength(1);
    expect(sBody.results[0]).toMatchObject({ status: 'passed', eval_run_id: skillRun.run.id });

    expect((await app.inject({ method: 'DELETE', url: `/agents/${agent.id}` })).statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: `/eval-runs/${skillRun.run.id}` });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({
      owner_kind: 'skill',
      agent_id: null,
      agent_name: 'Security Reviewer',
      agent_deleted: true,
    });

    expect(llmCalls()).toBe(0);
    await app.close();
  });

  it('answers 404 for a run of another workspace, of either owner', async () => {
    const { app, llmCalls } = await appWith();
    const [ws2] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-detail-${seq++}` })
      .returning();
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: ws2!.id,
        name: `foreign-agent-${seq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review the diff.',
      })
      .returning();
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: ws2!.id,
        name: `foreign-skill-${seq++}`,
        description: 'foreign',
        type: 'custom',
        source: 'manual',
        body: 'Foreign rule.',
      })
      .returning();
    const agentRun = await addRun(ws2!.id, { kind: 'agent', agentId: agent!.id });
    const skillRun = await addRun(ws2!.id, {
      kind: 'skill',
      skillId: skill!.id,
      skillVersion: 1,
      viaAgentId: agent!.id,
      agentName: agent!.name,
    });

    for (const id of [agentRun.run.id, skillRun.run.id]) {
      const res = await app.inject({ method: 'GET', url: `/eval-runs/${id}` });
      expect(res.statusCode, id).toBe(404);
    }
    expect(llmCalls()).toBe(0);
    await app.close();
  });
});

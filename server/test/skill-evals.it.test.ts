/**
 * Skill evals end to end — against a real Postgres (SPEC-06 AC12, AC18–AC24).
 * A skill's cases run through the agent remembered for the skill, with the skill on for
 * that run only; the run records the skill and agent versions, survives the agent's
 * deletion, disappears with the skill, and never reaches agent views or dashboards.
 *
 * Skills, agents and links are created through the HTTP API so versions are real. The
 * agent's model is a scripted `openai` provider (counts calls, records every request, can
 * block on a gate); it cites the range named by a `CITE <file> <start>-<end>` PR title.
 * `anthropic` / `openrouter` throw, GitHub / git / repo-intel / docs are mocked, so no real
 * network or LLM call is made (server INSIGHTS 2026-09-26).
 *
 * Every poll ASSERTS a terminal status (2026-09-19); nothing `running` is inserted before
 * `buildApp()` (2026-09-29); directly inserted cases of one owner get distinct names.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
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
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { MockGitClient, MockGitHubClient, MockRepoDocsReader } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
// `verify:l06` sets EVAL_IT_REQUIRED=1 so a missing Docker fails instead of skipping.
const d = hasDocker || process.env.EVAL_IT_REQUIRED === '1' ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function neverCalled(name: string): never {
  throw new Error(`${name} must never be called by this test`);
}

class ThrowingLLMProvider implements LLMProvider {
  constructor(readonly id: 'openai' | 'anthropic' | 'openrouter') {}
  listModels(): Promise<ModelInfo[]> {
    return neverCalled(`LLMProvider(${this.id}).listModels`);
  }
  complete(): Promise<CompletionResult> {
    return neverCalled(`LLMProvider(${this.id}).complete`);
  }
  completeStructured<T>(): Promise<StructuredResult<T>> {
    return neverCalled(`LLMProvider(${this.id}).completeStructured`);
  }
  embed(): Promise<number[][]> {
    return neverCalled(`LLMProvider(${this.id}).embed`);
  }
}

type Message = { role: string; content: string };

/** Scripted agent model: one finding on the range a `CITE <file> <a>-<b>` line names, else none. */
class ScriptedLLM implements LLMProvider {
  readonly id = 'openai' as const;
  requests: Message[][] = [];
  private gate: Promise<void> | null = null;

  /** Blocks every request until the returned function is called. */
  block(): () => void {
    let open!: () => void;
    this.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    return () => {
      open();
      this.gate = null;
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  async complete(): Promise<CompletionResult> {
    return neverCalled('ScriptedLLM.complete');
  }
  async embed(): Promise<number[][]> {
    return neverCalled('ScriptedLLM.embed');
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.requests.push(req.messages as Message[]);
    if (this.gate) await this.gate;
    const text = req.messages.map((m) => m.content).join('\n');
    const cite = /CITE (\S+) (\d+)-(\d+)/.exec(text);
    const findings = cite
      ? [
          {
            id: 'f1',
            severity: 'WARNING',
            category: 'bug',
            title: 'Scripted finding',
            file: cite[1],
            start_line: Number(cite[2]),
            end_line: Number(cite[3]),
            rationale: 'Because.',
            confidence: 0.9,
            kind: 'finding',
          },
        ]
      : [];
    const fixture = { verdict: 'comment', summary: 's', score: 80, findings };
    return {
      data: req.schema.parse(fixture),
      model: req.model,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
      raw: JSON.stringify(fixture),
      attempts: 1,
    };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

/** New lines 1..3; line 2 is the added one. */
const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' const a = 1;',
  "+const secret = 'x';",
  ' export { a };',
].join('\n');

function expectedJson(start: number, end: number): string {
  return JSON.stringify([
    { severity: 'WARNING', category: 'bug', title: 'Hardcoded secret', file: 'src/a.ts', start_line: start, end_line: end },
  ]);
}

function draft(name: string, over: Record<string, unknown> = {}) {
  return {
    name,
    input_diff: DIFF,
    pr_title: 'CITE src/a.ts 2-2',
    pr_description: 'Adds a secret.',
    expectation_type: 'must_find',
    expectation: { file: 'src/a.ts', start_line: 2, end_line: 2 },
    expected_output_json: expectedJson(2, 2),
    ...over,
  };
}

type RunSummary = {
  id: string;
  status: string;
  skill_id: string;
  skill_version: number;
  agent_id: string | null;
  agent_name: string;
  agent_version: number;
  agent_deleted: boolean;
};

d('skill evals (Testcontainers pg)', () => {
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

  async function appWith() {
    const llm = new ScriptedLLM();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        repoIntel: {} as unknown as RepoIntel,
        repoDocs: new MockRepoDocsReader(),
        llm: {
          openai: llm,
          anthropic: new ThrowingLLMProvider('anthropic'),
          openrouter: new ThrowingLLMProvider('openrouter'),
        },
        // Each test starts more runs than the default 10 / min; the limit has its own test.
        runStartLimiter: new RunStartLimiter({ max: 1_000 }),
      },
    });
    return { app, llm };
  }

  async function postJson(app: FastifyInstance, url: string, payload?: Record<string, unknown>) {
    return app.inject({ method: 'POST', url, ...(payload ? { payload } : {}) });
  }

  async function createSkill(app: FastifyInstance, body = `Rule text ${seq}.`) {
    const res = await postJson(app, '/skills', {
      name: `skill-evals-${seq++}`,
      description: 'About it',
      type: 'custom',
      body,
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; name: string; body: string; version: number };
  }

  async function createAgent(app: FastifyInstance) {
    const res = await postJson(app, '/agents', {
      name: `skill-evals-agent-${seq++}`,
      provider: 'openai',
      model: 'gpt-4.1',
      system_prompt: 'Review the diff.',
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; name: string };
  }

  async function addCase(app: FastifyInstance, kind: 'agents' | 'skills', ownerId: string, name: string) {
    const res = await postJson(app, `/${kind}/${ownerId}/eval-cases`, draft(name));
    expect(res.statusCode).toBe(201);
    return res.json().case as { id: string; revision_id: string };
  }

  async function rememberAgent(app: FastifyInstance, skillId: string, agentId: string) {
    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${skillId}/eval-agent`,
      payload: { agent_id: agentId },
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  /** Polls the skill's run list until `runId` leaves `running`, then ASSERTS it is terminal. */
  async function waitSkillRun(app: FastifyInstance, skillId: string, runId: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    const read = async () =>
      ((await app.inject({ method: 'GET', url: `/skills/${skillId}/eval-runs` })).json() as RunSummary[]).find(
        (r) => r.id === runId,
      );
    let run = await read();
    while ((!run || run.status === 'running') && Date.now() < deadline) {
      await sleep(50);
      run = await read();
    }
    expect(['completed', 'failed']).toContain(run?.status);
    return run!;
  }

  /** Polls an agent run's detail until it leaves `running`, then ASSERTS it is terminal. */
  async function waitAgentRun(app: FastifyInstance, runId: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    const read = async () => (await app.inject({ method: 'GET', url: `/eval-runs/${runId}` })).json();
    let run = await read();
    while (run.status === 'running' && Date.now() < deadline) {
      await sleep(50);
      run = await read();
    }
    expect(['completed', 'failed']).toContain(run.status);
    return run;
  }

  /** Polls a case's detail until its check leaves `running`, then ASSERTS it is terminal. */
  async function waitCheck(app: FastifyInstance, url: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    const read = async () => (await app.inject({ method: 'GET', url })).json();
    let detail = await read();
    while ((!detail.check || detail.check.status === 'running') && Date.now() < deadline) {
      await sleep(50);
      detail = await read();
    }
    expect(['passed', 'failed', 'errored']).toContain(detail.check?.status);
    return detail;
  }

  const suiteRun = async (runId: string) =>
    (await pg.handle.db.select().from(t.evalSuiteRuns).where(eq(t.evalSuiteRuns.id, runId)))[0]!;

  it(
    'runs a skill through its remembered agent, records versions and survives the agent (AC18–AC22, EC19–EC23)',
    async () => {
      const { app, llm } = await appWith();
      const originalBody = `Skill body ${seq} never linked as enabled.`;
      const skill = await createSkill(app, originalBody);
      const other = await createSkill(app);
      const agent = await createAgent(app);

      // EC19 / EC20: the skill is off on the skill list and linked but switched off on the agent.
      expect((await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { enabled: false } })).statusCode).toBe(200);
      const linked = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/skills`,
        payload: {
          items: [
            { skill_id: other.id, enabled: true },
            { skill_id: skill.id, enabled: false },
          ],
        },
      });
      expect(linked.statusCode).toBe(200);
      const linksBefore = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/skills` })).json();

      // AC18: no remembered agent → refused; choosing one is remembered; no cases → refused.
      const noAgent = await postJson(app, `/skills/${skill.id}/eval-runs`);
      expect(noAgent.statusCode).toBe(422);
      expect(noAgent.json().error.code).toBe('eval_agent_required');
      expect(await rememberAgent(app, skill.id, agent.id)).toEqual({
        agent: { id: agent.id, name: agent.name },
        missing_agent_name: null,
      });
      const noCases = await postJson(app, `/skills/${skill.id}/eval-runs`);
      expect(noCases.statusCode).toBe(422);
      expect(noCases.json().error.code).toBe('no_eval_cases');

      const skillCase = await addCase(app, 'skills', skill.id, 'skill-case');
      await addCase(app, 'agents', agent.id, 'agent-case');
      const skillVersion = (await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json().version as number;
      const agentVersion = (await app.inject({ method: 'GET', url: `/agents/${agent.id}` })).json().version as number;

      const release = llm.block();
      const started = await postJson(app, `/skills/${skill.id}/eval-runs`);
      expect(started.statusCode).toBe(202);
      const runId = started.json().run_id as string;

      // AC19: the run's config holds the skill on, at its link order, with its current body.
      const row = await suiteRun(runId);
      const inRun = row.config.skills.find((s) => s.id === skill.id);
      expect(inRun).toMatchObject({
        order: 1,
        link_enabled: true,
        skill_enabled: true,
        body: originalBody,
        version: skillVersion,
      });
      // AC20: the run records the skill version and the via agent.
      expect(row).toMatchObject({
        agentId: null,
        skillId: skill.id,
        skillVersion,
        viaAgentId: agent.id,
        agentName: agent.name,
        agentVersion,
      });

      // EC23: editing the skill during the run leaves the recorded version unchanged.
      const edited = await app.inject({
        method: 'PUT',
        url: `/skills/${skill.id}`,
        payload: { body: 'A newer rule text.' },
      });
      expect(edited.statusCode).toBe(200);
      expect(edited.json().version).toBeGreaterThan(skillVersion);
      expect((await suiteRun(runId)).skillVersion).toBe(skillVersion);

      // EC22: the agent's own run starts beside the skill run; a second skill run is refused.
      const agentRun = await postJson(app, `/agents/${agent.id}/eval-runs`);
      expect(agentRun.statusCode).toBe(202);
      const agentRunId = agentRun.json().run_id as string;
      const second = await postJson(app, `/skills/${skill.id}/eval-runs`);
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe('eval_run_in_progress');

      release();
      const done = await waitSkillRun(app, skill.id, runId);
      await waitAgentRun(app, agentRunId);

      // AC19: the prompt carried the run-time skill body; the agent's saved links did not change.
      expect(llm.requests.some((m) => m.map((x) => x.content).join('\n').includes(originalBody))).toBe(true);
      expect((await app.inject({ method: 'GET', url: `/agents/${agent.id}/skills` })).json()).toEqual(linksBefore);

      // AC22: the skill's history lists the run with the agent and both versions.
      expect(done).toMatchObject({
        skill_id: skill.id,
        skill_version: skillVersion,
        agent_id: agent.id,
        agent_name: agent.name,
        agent_version: agentVersion,
        agent_deleted: false,
      });

      // SPEC-06 AC15 / A9: a single-case check adds no run row.
      const runsBefore = await pg.handle.db.select().from(t.evalSuiteRuns);
      const caseUrl = `/skills/${skill.id}/eval-cases/${skillCase.id}`;
      expect((await postJson(app, `${caseUrl}/check`)).statusCode).toBe(202);
      await waitCheck(app, caseUrl);
      expect(await pg.handle.db.select().from(t.evalSuiteRuns)).toHaveLength(runsBefore.length);

      // SPEC-05 dashboards never show a skill run.
      const workspace = (await app.inject({ method: 'GET', url: '/eval-dashboard' })).json();
      expect(workspace.recent_runs.map((r: { id: string }) => r.id)).not.toContain(runId);
      expect(workspace.agents.map((a: { latest: { id: string } | null }) => a.latest?.id)).not.toContain(runId);
      const agentDash = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` })).json();
      const agentDashIds = agentDash.runs.map((r: { id: string }) => r.id);
      expect(agentDashIds).toContain(agentRunId);
      expect(agentDashIds).not.toContain(runId);
      const agentRuns = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` })).json();
      expect(agentRuns.map((r: { id: string }) => r.id)).toEqual([agentRunId]);

      // AC21 / AC22: the agent is deleted; the run stays with its name, the skill asks for another.
      expect((await app.inject({ method: 'DELETE', url: `/agents/${agent.id}` })).statusCode).toBe(200);
      const after = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-runs` })).json() as RunSummary[];
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ id: runId, agent_id: null, agent_name: agent.name, agent_deleted: true });
      const remembered = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-agent` })).json();
      expect(remembered).toEqual({ agent: null, missing_agent_name: agent.name });
      const missing = await postJson(app, `/skills/${skill.id}/eval-runs`);
      expect(missing.statusCode).toBe(422);
      expect(missing.json().error.code).toBe('eval_agent_missing');

      await app.close();
    },
    90_000,
  );

  it(
    'deleting a skill removes its cases, revisions, checks, runs and per-case rows (AC23, EC24)',
    async () => {
      const { app } = await appWith();
      const skill = await createSkill(app);
      const agent = await createAgent(app);
      await rememberAgent(app, skill.id, agent.id);
      const skillCase = await addCase(app, 'skills', skill.id, 'doomed-case');

      const started = await postJson(app, `/skills/${skill.id}/eval-runs`);
      expect(started.statusCode).toBe(202);
      const runId = started.json().run_id as string;
      await waitSkillRun(app, skill.id, runId);
      const caseUrl = `/skills/${skill.id}/eval-cases/${skillCase.id}`;
      expect((await postJson(app, `${caseUrl}/check`)).statusCode).toBe(202);
      await waitCheck(app, caseUrl);

      const { db } = pg.handle;
      const counts = async () => ({
        cases: (await db.select().from(t.evalCases).where(eq(t.evalCases.skillId, skill.id))).length,
        revisions: (await db.select().from(t.evalCaseRevisions).where(eq(t.evalCaseRevisions.caseId, skillCase.id))).length,
        checks: (await db.select().from(t.evalCaseChecks).where(eq(t.evalCaseChecks.caseId, skillCase.id))).length,
        runs: (await db.select().from(t.evalSuiteRuns).where(eq(t.evalSuiteRuns.skillId, skill.id))).length,
        perCase: (await db.select().from(t.evalRuns).where(inArray(t.evalRuns.suiteRunId, [runId]))).length,
        agent: (await db.select().from(t.skillEvalAgents).where(eq(t.skillEvalAgents.skillId, skill.id))).length,
      });
      expect(await counts()).toEqual({ cases: 1, revisions: 1, checks: 1, runs: 1, perCase: 1, agent: 1 });

      expect((await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` })).statusCode).toBe(200);
      expect(await counts()).toEqual({ cases: 0, revisions: 0, checks: 0, runs: 0, perCase: 0, agent: 0 });
      // The agent itself is untouched.
      expect((await app.inject({ method: 'GET', url: `/agents/${agent.id}` })).statusCode).toBe(200);
      await app.close();
    },
    60_000,
  );

  it(
    'compares a case at two revisions as one added and one removed (AC12, EC15)',
    async () => {
      const { app } = await appWith();
      const agent = await createAgent(app);
      const first = await addCase(app, 'agents', agent.id, 'rev-one');
      await addCase(app, 'agents', agent.id, 'rev-two');
      await addCase(app, 'agents', agent.id, 'rev-three');

      const runA = (await postJson(app, `/agents/${agent.id}/eval-runs`)).json().run_id as string;
      await waitAgentRun(app, runA);

      const edit = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/eval-cases/${first.id}`,
        payload: draft('rev-one', {
          expectation: { file: 'src/a.ts', start_line: 2, end_line: 3 },
          expected_output_json: expectedJson(2, 3),
        }),
      });
      expect(edit.statusCode).toBe(200);
      expect(edit.json().revision_created).toBe(true);

      const runB = (await postJson(app, `/agents/${agent.id}/eval-runs`)).json().run_id as string;
      const later = await waitAgentRun(app, runB);
      // AC12: the later run records the edited case at its new revision.
      expect(later.cases.find((c: { case_id: string }) => c.case_id === first.id).revision).toBe(2);

      const compare = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/eval-runs/compare?a=${runA}&b=${runB}`,
      });
      expect(compare.statusCode).toBe(200);
      expect(compare.json().case_sets).toEqual({ added: 1, removed: 1 });
      await app.close();
    },
    60_000,
  );

  it(
    "answers 404 for another workspace's skill, agent or case on every skill route, with no model call (AC24)",
    async () => {
      const { app, llm } = await appWith();
      const skill = await createSkill(app);
      const { db } = pg.handle;

      const [otherWs] = await db.insert(t.workspaces).values({ name: `other-skill-evals-${seq++}` }).returning();
      const [foreignAgent] = await db
        .insert(t.agents)
        .values({
          workspaceId: otherWs!.id,
          name: `foreign-agent-${seq++}`,
          provider: 'openai',
          model: 'gpt-4.1',
          systemPrompt: 'Review the diff.',
        })
        .returning();
      const [foreignSkill] = await db
        .insert(t.skills)
        .values({
          workspaceId: otherWs!.id,
          name: `foreign-skill-${seq++}`,
          description: 'About it',
          type: 'custom',
          source: 'manual',
          body: 'Rule text.',
        })
        .returning();
      await db.insert(t.skillEvalAgents).values({
        skillId: foreignSkill!.id,
        workspaceId: otherWs!.id,
        agentId: foreignAgent!.id,
        agentName: foreignAgent!.name,
      });
      const [foreignCase] = await db
        .insert(t.evalCases)
        .values({
          workspaceId: otherWs!.id,
          ownerKind: 'skill',
          ownerId: foreignSkill!.id,
          skillId: foreignSkill!.id,
          name: `foreign-case-${seq++}`,
        })
        .returning();
      await db.insert(t.evalCaseRevisions).values({
        workspaceId: otherWs!.id,
        caseId: foreignCase!.id,
        revision: 1,
        inputDiff: DIFF,
        inputFiles: ['src/a.ts'],
        inputMeta: { pr_title: 'CITE src/a.ts 2-2', pr_description: '' },
        expectationType: 'must_find',
        expectation: { file: 'src/a.ts', start_line: 2, end_line: 2 },
      });

      const own = `/skills/${skill.id}`;
      const foreign = `/skills/${foreignSkill!.id}`;
      const notFound: [string, string, Record<string, unknown>?][] = [
        ['GET', `${foreign}/eval-cases`],
        ['POST', `${foreign}/eval-cases`, draft('foreign-new')],
        ['GET', `${foreign}/eval-cases/${foreignCase!.id}`],
        ['PUT', `${foreign}/eval-cases/${foreignCase!.id}`, draft('foreign-edit')],
        ['POST', `${foreign}/eval-cases/${foreignCase!.id}/check`],
        ['GET', `${own}/eval-cases/${foreignCase!.id}`],
        ['PUT', `${own}/eval-cases/${foreignCase!.id}`, draft('foreign-edit')],
        ['POST', `${own}/eval-cases/${foreignCase!.id}/check`],
        ['GET', `${foreign}/eval-agent`],
        ['PUT', `${foreign}/eval-agent`, { agent_id: foreignAgent!.id }],
        ['PUT', `${own}/eval-agent`, { agent_id: foreignAgent!.id }],
        ['POST', `${foreign}/eval-runs`],
        ['GET', `${foreign}/eval-runs`],
      ];
      for (const [method, url, payload] of notFound) {
        const res = await app.inject({
          method: method as 'GET' | 'POST' | 'PUT',
          url,
          ...(payload ? { payload } : {}),
        });
        expect([method, url, res.statusCode]).toEqual([method, url, 404]);
      }

      expect(await db.select().from(t.evalSuiteRuns).where(eq(t.evalSuiteRuns.skillId, foreignSkill!.id))).toHaveLength(0);
      expect(await db.select().from(t.evalCaseChecks).where(eq(t.evalCaseChecks.caseId, foreignCase!.id))).toHaveLength(0);
      expect(await db.select().from(t.skillEvalAgents).where(eq(t.skillEvalAgents.skillId, skill.id))).toHaveLength(0);
      expect(llm.requests).toHaveLength(0);
      await app.close();
    },
    60_000,
  );
});

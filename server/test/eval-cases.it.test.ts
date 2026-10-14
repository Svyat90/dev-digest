/**
 * Case editor routes — against a real Postgres (SPEC-06 AC3, AC4, AC8–AC11, AC14–AC16, AC24, AC25).
 * The agent's model is a scripted `openai` provider (counts calls, records every request, can block
 * on a gate); it cites the range named by a `CITE <file> <start>-<end>` PR title and returns no
 * finding otherwise. `anthropic` / `openrouter` throw, GitHub / git / repo-intel / docs are mocked,
 * so no real network or LLM call is made (server INSIGHTS 2026-09-26).
 *
 * Directly inserted cases of one owner get distinct names; nothing `running` is inserted before
 * `buildApp()` (server INSIGHTS 2026-09-29); every poll asserts a terminal status (2026-09-19).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
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

/** Both markers skipped by the engine parser (T022): new lines 1 (ctx), 2 and 3 (added). */
const NO_NEWLINE_DIFF = [
  '--- a/src/n.ts',
  '+++ b/src/n.ts',
  '@@ -1,2 +1,3 @@',
  ' const a = 1;',
  '-export { a }',
  '\\ No newline at end of file',
  '+export { a };',
  '+const b = 2;',
  '\\ No newline at end of file',
].join('\n');

const EXPECTED_TITLE = 'Expected-title-never-sent';

function expectedJson(file: string, start: number, end: number): string {
  return JSON.stringify([
    { severity: 'WARNING', category: 'bug', title: EXPECTED_TITLE, file, start_line: start, end_line: end },
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
    expected_output_json: expectedJson('src/a.ts', 2, 2),
    ...over,
  };
}

type Issue = { field: string; code: string; line: number | null; key: string | null };
const issuesOf = (body: { error: { code: string; details?: { issues?: Issue[] } } }) =>
  body.error.details?.issues ?? [];

d('eval case editor routes (Testcontainers pg)', () => {
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
        ...(runStartLimiter ? { runStartLimiter } : {}),
      },
    });
    return { app, llm };
  }

  async function addAgent(wsId = workspaceId) {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: wsId,
        name: `case-agent-${seq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review the diff.',
      })
      .returning();
    return agent!;
  }

  async function addSkill(wsId = workspaceId) {
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: wsId,
        name: `case-skill-${seq++}`,
        description: 'About it',
        type: 'custom',
        source: 'manual',
        body: 'Rule text.',
      })
      .returning();
    return skill!;
  }

  /** A finding-made case through SPEC-04's flow (POST /findings/:id/eval-case). */
  async function findingCase(app: FastifyInstance, agentId: string, title: string) {
    const name = `cases-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath: '/clone' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 700 + seq,
        title: 'Add handler',
        author: 'dev',
        branch: 'feat/c',
        base: 'main',
        headSha: 'shaC',
        additions: 2,
        deletions: 0,
        filesCount: 1,
        status: 'open',
        body: 'Adds a handler.',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/f.ts',
      additions: 2,
      deletions: 0,
      patch: '@@ -10,2 +10,4 @@\n ctx\n+one\n+two\n ctx',
    });
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr!.id, agentId, kind: 'review', model: 'gpt-4.1' })
      .returning();
    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/f.ts',
        startLine: 11,
        endLine: 12,
        severity: 'WARNING',
        category: 'bug',
        title,
        rationale: 'Because.',
        confidence: 0.8,
        kind: 'finding',
        acceptedAt: new Date(),
      })
      .returning();
    const res = await app.inject({ method: 'POST', url: `/findings/${finding!.id}/eval-case` });
    expect(res.statusCode).toBe(201);
    return res.json().case as { id: string; name: string };
  }

  const revisionsOf = (caseId: string) =>
    pg.handle.db.select().from(t.evalCaseRevisions).where(eq(t.evalCaseRevisions.caseId, caseId));

  const caseUrl = (kind: 'agents' | 'skills', ownerId: string, caseId?: string) =>
    `/${kind}/${ownerId}/eval-cases${caseId ? `/${caseId}` : ''}`;

  async function create(app: FastifyInstance, agentId: string, body: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: caseUrl('agents', agentId), payload: body });
  }

  /** Polls the detail until its check leaves `running`, then ASSERTS it is terminal. */
  async function waitCheck(app: FastifyInstance, agentId: string, caseId: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    const read = async () =>
      (await app.inject({ method: 'GET', url: caseUrl('agents', agentId, caseId) })).json();
    let detail = await read();
    while ((!detail.check || detail.check.status === 'running') && Date.now() < deadline) {
      await sleep(50);
      detail = await read();
    }
    expect(['passed', 'failed', 'errored']).toContain(detail.check?.status);
    return detail;
  }

  async function waitRun(app: FastifyInstance, runId: string, timeoutMs = 30_000) {
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

  it(
    'creates, validates and revises manual cases; names are unique per set (AC3, AC4, AC8–AC11)',
    async () => {
      const { app, llm } = await appWith();
      const agent = await addAgent();
      const skill = await addSkill();

      // AC9: a valid draft is stored as revision 1 and listed with no result.
      const created = await create(app, agent.id, draft('manual-one'));
      expect(created.statusCode).toBe(201);
      const saved = created.json();
      expect(saved.revision_created).toBe(true);
      expect(saved.case).toMatchObject({
        name: 'manual-one',
        revision: 1,
        origin: 'manual',
        provenance: null,
        input_diff: DIFF,
        owner: { kind: 'agent', id: agent.id },
      });
      const caseId = saved.case.id as string;
      const list = (await app.inject({ method: 'GET', url: caseUrl('agents', agent.id) })).json();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: caseId, latest_result: null, check: null });

      // AC3: a stray line names its line; AC4: a 301-char title is too long.
      const stray = await create(app, agent.id, draft('stray', { input_diff: `${DIFF}\njunk line` }));
      expect(stray.statusCode).toBe(422);
      expect(stray.json().error.code).toBe('eval_case_invalid');
      expect(issuesOf(stray.json())).toContainEqual({
        field: 'input_diff',
        code: 'diff_stray_line',
        line: 8,
        key: null,
      });
      const long = await create(app, agent.id, draft('long', { pr_title: 'x'.repeat(301) }));
      expect(long.statusCode).toBe(422);
      expect(issuesOf(long.json()).map((i) => [i.field, i.code])).toContainEqual(['pr_title', 'too_long']);

      // AC8: a duplicate name in the set is refused with a reason, never a 500.
      const dup = await create(app, agent.id, draft('manual-one'));
      expect(dup.statusCode).toBe(422);
      expect(issuesOf(dup.json()).map((i) => i.code)).toEqual(['name_taken']);

      // AC8 against a finding-made case of the same agent; the same name in a skill's set is fine (EC11).
      const fromFinding = await findingCase(app, agent.id, 'Hardcoded Key');
      const rename = await app.inject({
        method: 'PUT',
        url: caseUrl('agents', agent.id, caseId),
        payload: draft(fromFinding.name),
      });
      expect(rename.statusCode).toBe(422);
      expect(issuesOf(rename.json()).map((i) => i.code)).toEqual(['name_taken']);
      const skillCase = await app.inject({
        method: 'POST',
        url: caseUrl('skills', skill.id),
        payload: draft(fromFinding.name),
      });
      expect(skillCase.statusCode).toBe(201);
      expect(skillCase.json().case.owner).toEqual({ kind: 'skill', id: skill.id });

      // AC11: a name-only edit writes no revision.
      const nameOnly = await app.inject({
        method: 'PUT',
        url: caseUrl('agents', agent.id, caseId),
        payload: draft('manual-renamed'),
      });
      expect(nameOnly.statusCode).toBe(200);
      expect(nameOnly.json().revision_created).toBe(false);
      expect(nameOnly.json().case.name).toBe('manual-renamed');
      expect(await revisionsOf(caseId)).toHaveLength(1);

      // AC11: a content edit stores revision 2 and keeps revision 1.
      const firstRevisionId = saved.case.revision_id as string;
      const edited = await app.inject({
        method: 'PUT',
        url: caseUrl('agents', agent.id, caseId),
        payload: draft('manual-renamed', {
          expectation: { file: 'src/a.ts', start_line: 2, end_line: 3 },
          expected_output_json: expectedJson('src/a.ts', 2, 3),
        }),
      });
      expect(edited.statusCode).toBe(200);
      expect(edited.json().revision_created).toBe(true);
      expect(edited.json().case.revision).toBe(2);
      const revisions = await revisionsOf(caseId);
      expect(revisions.map((r) => r.revision).sort()).toEqual([1, 2]);
      expect(revisions.find((r) => r.revision === 1)!.id).toBe(firstRevisionId);

      // AC10: a finding-made case cannot change its diff.
      const detail = (
        await app.inject({ method: 'GET', url: caseUrl('agents', agent.id, fromFinding.id) })
      ).json();
      expect(detail.origin).toBe('finding');
      const fixed = await app.inject({
        method: 'PUT',
        url: caseUrl('agents', agent.id, fromFinding.id),
        payload: {
          name: detail.name,
          input_diff: `${detail.input_diff}\n+changed`,
          pr_title: detail.input_meta.pr_title,
          pr_description: detail.input_meta.pr_description,
          expectation_type: detail.expectation_type,
          expectation: detail.expectation,
          expected_output_json: JSON.stringify(detail.expected_output),
        },
      });
      expect(fixed.statusCode).toBe(422);
      expect(fixed.json().error.code).toBe('eval_case_content_fixed');

      expect(llm.requests).toHaveLength(0);
      await app.close();
    },
    60_000,
  );

  it(
    'runs one case as a scratch check, apart from run history (AC14–AC16, AC25, EC14, EC17)',
    async () => {
      const { app, llm } = await appWith();
      const agent = await addAgent();
      const caseId = (await create(app, agent.id, draft('check-me'))).json().case.id as string;
      const before = (await revisionsOf(caseId))[0]!;

      // A full run held open by the gate; a check of the same case is still allowed (AC15, EC17).
      const release = llm.block();
      const run = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
      expect(run.statusCode).toBe(202);
      const runId = run.json().run_id as string;

      const check = await app.inject({ method: 'POST', url: `${caseUrl('agents', agent.id, caseId)}/check` });
      expect(check.statusCode).toBe(202); // answered before the review ends
      expect(check.json().check_id).toEqual(expect.any(String));
      const running = (await app.inject({ method: 'GET', url: caseUrl('agents', agent.id, caseId) })).json();
      expect(running.check.status).toBe('running');

      // AC16: one check per case at a time.
      const again = await app.inject({ method: 'POST', url: `${caseUrl('agents', agent.id, caseId)}/check` });
      expect(again.statusCode).toBe(409);
      expect(again.json().error.code).toBe('eval_case_check_in_progress');

      // EC14: an edit during the run gives a new revision; the run keeps the revision it started with.
      const edit = await app.inject({
        method: 'PUT',
        url: caseUrl('agents', agent.id, caseId),
        payload: draft('check-me', {
          expectation: { file: 'src/a.ts', start_line: 2, end_line: 3 },
          expected_output_json: expectedJson('src/a.ts', 2, 3),
        }),
      });
      expect(edit.json().revision_created).toBe(true);

      release();
      const done = await waitRun(app, runId);
      expect(done.results).toHaveLength(1);
      expect(done.results[0].case_revision_id).toBe(before.id);

      // AC15: the check is not a run.
      const runs = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` })).json();
      expect(runs.map((r: { id: string }) => r.id)).toEqual([runId]);

      // The held check covered revision 1; it must close before the next one may start.
      const deadline = Date.now() + 30_000;
      const runningChecks = () =>
        pg.handle.db
          .select()
          .from(t.evalCaseChecks)
          .where(and(eq(t.evalCaseChecks.caseId, caseId), eq(t.evalCaseChecks.status, 'running')));
      while ((await runningChecks()).length > 0 && Date.now() < deadline) await sleep(50);
      expect(await runningChecks()).toHaveLength(0);

      // A check of the current revision 2 reads expected 1, got 1 (AC14).
      const fresh = await app.inject({ method: 'POST', url: `${caseUrl('agents', agent.id, caseId)}/check` });
      expect(fresh.statusCode).toBe(202);
      const checked = await waitCheck(app, agent.id, caseId);
      expect(checked.check.case_revision_id).toBe(checked.revision_id);
      expect(checked.last_run).toMatchObject({ source: 'check', status: 'passed', expected: 1, got: 1 });
      expect([0.001, null]).toContain(checked.last_run.cost_usd);

      // AC25: the model saw the diff and the title, never the case name or the expected title.
      for (const messages of llm.requests) {
        const text = messages.map((m) => m.content).join('\n');
        expect(text).toContain("+const secret = 'x';");
        expect(text).toContain('CITE src/a.ts 2-2');
        expect(text).not.toContain('check-me');
        expect(text).not.toContain(EXPECTED_TITLE);
      }
      await app.close();
    },
    60_000,
  );

  it(
    'grades against the editor line numbers when the diff carries "\\ No newline at end of file" (AC5, AC14)',
    async () => {
      const { app } = await appWith();
      const agent = await addAgent();
      const created = await create(
        app,
        agent.id,
        draft('no-newline', {
          input_diff: NO_NEWLINE_DIFF,
          pr_title: 'CITE src/n.ts 3-3',
          expectation: { file: 'src/n.ts', start_line: 3, end_line: 3 },
          expected_output_json: expectedJson('src/n.ts', 3, 3),
        }),
      );
      expect(created.statusCode).toBe(201);
      const caseId = created.json().case.id as string;
      const check = await app.inject({ method: 'POST', url: `${caseUrl('agents', agent.id, caseId)}/check` });
      expect(check.statusCode).toBe(202);
      const checked = await waitCheck(app, agent.id, caseId);
      expect(checked.check).toMatchObject({ status: 'passed', expected: 1, got: 1 });
      await app.close();
    },
    60_000,
  );

  it(
    'scopes every route to the workspace and the owner, with no model call (AC24)',
    async () => {
      const { app, llm } = await appWith();
      const agent = await addAgent();
      const skill = await addSkill();
      const skillCase = await app.inject({ method: 'POST', url: caseUrl('skills', skill.id), payload: draft('skill-case') });
      expect(skillCase.statusCode).toBe(201);
      const skillCaseId = skillCase.json().case.id as string;

      const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: `other-cases-${seq++}` }).returning();
      const foreignAgent = await addAgent(otherWs!.id);
      const foreignSkill = await addSkill(otherWs!.id);
      const [foreignCase] = await pg.handle.db
        .insert(t.evalCases)
        .values({
          workspaceId: otherWs!.id,
          ownerKind: 'agent',
          ownerId: foreignAgent.id,
          agentId: foreignAgent.id,
          name: `foreign-${seq++}`,
        })
        .returning();
      await pg.handle.db.insert(t.evalCaseRevisions).values({
        workspaceId: otherWs!.id,
        caseId: foreignCase!.id,
        revision: 1,
        inputDiff: DIFF,
        inputFiles: ['src/a.ts'],
        inputMeta: { pr_title: 'CITE src/a.ts 2-2', pr_description: '' },
        expectationType: 'must_find',
        expectation: { file: 'src/a.ts', start_line: 2, end_line: 2 },
      });

      const notFound: [string, string, unknown?][] = [
        ['GET', caseUrl('agents', agent.id, skillCaseId)],
        ['POST', `${caseUrl('agents', agent.id, skillCaseId)}/check`],
        ['GET', caseUrl('agents', foreignAgent.id)],
        ['POST', caseUrl('agents', foreignAgent.id), draft('foreign-new')],
        ['GET', caseUrl('skills', foreignSkill.id)],
        ['GET', caseUrl('agents', agent.id, foreignCase!.id)],
        ['PUT', caseUrl('agents', agent.id, foreignCase!.id), draft('foreign-edit')],
        ['POST', `${caseUrl('agents', agent.id, foreignCase!.id)}/check`],
        ['POST', `${caseUrl('agents', foreignAgent.id, foreignCase!.id)}/check`],
        ['PUT', `/skills/${skill.id}/eval-agent`, { agent_id: foreignAgent.id }],
        ['POST', `/skills/${foreignSkill.id}/eval-runs`],
      ];
      for (const [method, url, payload] of notFound) {
        const res = await app.inject({
          method: method as 'GET' | 'POST' | 'PUT',
          url,
          ...(payload ? { payload: payload as Record<string, unknown> } : {}),
        });
        expect([url, res.statusCode]).toEqual([url, 404]);
      }
      const foreignChecks = await pg.handle.db
        .select()
        .from(t.evalCaseChecks)
        .where(eq(t.evalCaseChecks.caseId, foreignCase!.id));
      expect(foreignChecks).toHaveLength(0);
      expect(llm.requests).toHaveLength(0);
      await app.close();
    },
    60_000,
  );

  it(
    'counts a check against the shared run-start limit (SPEC-06 NFR, 429 creates nothing)',
    async () => {
      const { app } = await appWith(new RunStartLimiter({ max: 1 }));
      const agent = await addAgent();
      const one = (await create(app, agent.id, draft('limit-one'))).json().case.id as string;
      const two = (await create(app, agent.id, draft('limit-two'))).json().case.id as string;

      const first = await app.inject({ method: 'POST', url: `${caseUrl('agents', agent.id, one)}/check` });
      expect(first.statusCode).toBe(202);
      const second = await app.inject({ method: 'POST', url: `${caseUrl('agents', agent.id, two)}/check` });
      expect(second.statusCode).toBe(429);
      expect(second.json().error.code).toBe('run_start_rate_limited');
      const rows = await pg.handle.db
        .select()
        .from(t.evalCaseChecks)
        .where(and(eq(t.evalCaseChecks.caseId, two), eq(t.evalCaseChecks.workspaceId, workspaceId)));
      expect(rows).toHaveLength(0);

      await waitCheck(app, agent.id, one);
      await app.close();
    },
    60_000,
  );
});

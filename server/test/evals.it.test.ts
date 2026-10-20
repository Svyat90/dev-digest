/**
 * Eval pipeline routes — against a real Postgres (SPEC-04 AC1–AC7, AC10, AC25). Every client a
 * request can reach is overridden: the three LLM providers (the unused ones throw), GitHub, git,
 * repo-intel and the docs reader, so no real network or LLM call is made (server INSIGHTS
 * 2026-09-26). Run behaviour (AC11/AC12/AC17) is proved in the scripted-run test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
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
} from '@devdigest/shared';
import {
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockRepoDocsReader,
} from '../src/adapters/mocks.js';
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

/** New lines 10..18 of the file. */
const PATCH = '@@ -10,3 +10,9 @@\n ctx\n+one\n+two\n+three\n+four\n+five\n+six\n ctx\n ctx';
const HUGE_PATCH = `@@ -1,1 +1,2 @@\n ctx\n+${'x'.repeat(100_001)}`;

let seq = 0;

d('evals routes (Testcontainers pg)', () => {
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
    const openai = new MockLLMProvider('openai', { structured: { findings: [], summary: 's' } });
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
      },
    });
    return { app, openai };
  }

  async function addAgent(wsId: string) {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: wsId,
        name: `eval-agent-${seq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review.',
      })
      .returning();
    return agent!;
  }

  async function addPr(wsId: string, patches: Record<string, string> = { 'src/a.ts': PATCH }) {
    const name = `evals-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: wsId, owner: 'acme', name, fullName: `acme/${name}`, clonePath: '/clone' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: wsId,
        repoId: repo!.id,
        number: 900 + seq,
        title: 'Add handler',
        author: 'dev',
        branch: 'feat/e',
        base: 'main',
        headSha: 'shaE',
        additions: 7,
        deletions: 0,
        filesCount: Object.keys(patches).length,
        status: 'open',
        body: 'Adds a handler.',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values(
      Object.entries(patches).map(([path, patch]) => ({
        prId: pr!.id,
        path,
        additions: 1,
        deletions: 0,
        patch,
      })),
    );
    return pr!;
  }

  async function addReview(
    wsId: string,
    prId: string,
    agentId: string | null,
    findings: {
      title: string;
      file?: string;
      start?: number;
      end?: number;
      kind?: string;
      accepted?: boolean;
      dismissed?: boolean;
    }[],
  ) {
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId: wsId, prId, agentId, kind: 'review', model: 'gpt-4.1' })
      .returning();
    const rows = await pg.handle.db
      .insert(t.findings)
      .values(
        findings.map((f) => ({
          reviewId: review!.id,
          file: f.file ?? 'src/a.ts',
          startLine: f.start ?? 12,
          endLine: f.end ?? 13,
          severity: 'WARNING',
          category: 'bug',
          title: f.title,
          rationale: 'Because.',
          confidence: 0.8,
          kind: f.kind ?? 'finding',
          acceptedAt: f.accepted ? new Date() : null,
          dismissedAt: f.dismissed ? new Date() : null,
        })),
      )
      .returning();
    return { review: review!, findings: rows };
  }

  it('creates must_find and must_not_flag cases with revision 1, idempotently, with unique names (AC1, AC2, AC5, AC6, AC3)', async () => {
    const { app, openai } = await appWith();
    const agent = await addAgent(workspaceId);
    const pr = await addPr(workspaceId);
    const { findings } = await addReview(workspaceId, pr.id, agent.id, [
      { title: 'Hardcoded Key', accepted: true },
      { title: 'Noisy Rule', dismissed: true },
      { title: 'Undecided One' },
      { title: 'Same Title', accepted: true },
      { title: 'Same Title', accepted: true, start: 14, end: 15 },
    ]);
    const [accepted, dismissed, undecided, same1, same2] = findings;

    const first = await app.inject({ method: 'POST', url: `/findings/${accepted!.id}/eval-case` });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json();
    expect(firstBody.created).toBe(true);
    expect(firstBody.case.name).toBe('hardcoded-key');
    expect(firstBody.case.revision).toBe(1);
    expect(firstBody.case.expectation_type).toBe('must_find');

    const repeat = await app.inject({ method: 'POST', url: `/findings/${accepted!.id}/eval-case` });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().created).toBe(false);
    expect(repeat.json().case.id).toBe(firstBody.case.id);
    expect(repeat.json().case.revision_id).toBe(firstBody.case.revision_id);

    const neg = await app.inject({ method: 'POST', url: `/findings/${dismissed!.id}/eval-case` });
    expect(neg.statusCode).toBe(201);
    expect(neg.json().case.expectation_type).toBe('must_not_flag');

    const revisions = await pg.handle.db
      .select()
      .from(t.evalCaseRevisions)
      .where(inArray(t.evalCaseRevisions.caseId, [firstBody.case.id, neg.json().case.id]));
    expect(revisions).toHaveLength(2);

    const refused = await app.inject({ method: 'POST', url: `/findings/${undecided!.id}/eval-case` });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error?.code ?? refused.json().code).toBe('eval_case_undecided');

    const a = await app.inject({ method: 'POST', url: `/findings/${same1!.id}/eval-case` });
    const b = await app.inject({ method: 'POST', url: `/findings/${same2!.id}/eval-case` });
    expect(a.json().case.name).toBe('same-title');
    expect(b.json().case.name).toBe('same-title-2');

    // The database holds the rule: a third row with the name fails, another agent may reuse it.
    const base = {
      workspaceId,
      ownerKind: 'agent' as const,
      ownerId: agent.id,
      agentId: agent.id,
      name: 'same-title',
    };
    await expect(pg.handle.db.insert(t.evalCases).values(base)).rejects.toThrow();
    const other = await addAgent(workspaceId);
    await expect(
      pg.handle.db
        .insert(t.evalCases)
        .values({ ...base, ownerId: other.id, agentId: other.id }),
    ).resolves.toBeDefined();

    const reviews = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` });
    const dto = reviews.json()[0].findings as { id: string; eval_case_id?: string | null }[];
    expect(dto.find((f) => f.id === accepted!.id)?.eval_case_id).toBe(firstBody.case.id);
    expect(dto.find((f) => f.id === undecided!.id)?.eval_case_id ?? null).toBeNull();

    expect(openai.calls).toHaveLength(0);
    await app.close();
  });

  it('refuses a case with no agent, a huge diff and lines outside the hunks; whole-file kinds pass (AC7, EC5)', async () => {
    const { app } = await appWith();
    const agent = await addAgent(workspaceId);
    const pr = await addPr(workspaceId, { 'src/a.ts': PATCH, 'src/big.ts': HUGE_PATCH });
    const agentless = await addReview(workspaceId, pr.id, null, [{ title: 'No Owner', accepted: true }]);
    const { findings } = await addReview(workspaceId, pr.id, agent.id, [
      { title: 'Huge', file: 'src/big.ts', start: 2, end: 2, accepted: true },
      { title: 'Outside', start: 200, end: 205, accepted: true },
      { title: 'Leaked Secret', start: 200, end: 205, kind: 'secret_leak', accepted: true },
    ]);

    const code = async (id: string) => {
      const res = await app.inject({ method: 'POST', url: `/findings/${id}/eval-case` });
      return { status: res.statusCode, body: res.json() };
    };
    const noAgent = await code(agentless.findings[0]!.id);
    expect(noAgent.status).toBe(422);
    expect(JSON.stringify(noAgent.body)).toContain('eval_case_no_agent');

    const huge = await code(findings[0]!.id);
    expect(JSON.stringify(huge.body)).toContain('eval_case_diff_too_large');
    const outside = await code(findings[1]!.id);
    expect(JSON.stringify(outside.body)).toContain('eval_case_lines_outside_diff');
    const secret = await code(findings[2]!.id);
    expect(secret.status).toBe(201);
    await app.close();
  });

  it('keeps a case and its frozen input after the PR is deleted (AC4, EC6)', async () => {
    const { app } = await appWith();
    const agent = await addAgent(workspaceId);
    const pr = await addPr(workspaceId);
    const { findings } = await addReview(workspaceId, pr.id, agent.id, [
      { title: 'Frozen Case', accepted: true },
    ]);
    const created = await app.inject({ method: 'POST', url: `/findings/${findings[0]!.id}/eval-case` });
    expect(created.statusCode).toBe(201);

    await pg.handle.db.delete(t.pullRequests).where(eq(t.pullRequests.id, pr.id));

    const list = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect(list.statusCode).toBe(200);
    const item = list.json()[0];
    expect(item.name).toBe('frozen-case');
    expect(item.input_meta.pr_title).toBe('Add handler');
    expect(item.latest_result).toBeNull();
    const [rev] = await pg.handle.db
      .select()
      .from(t.evalCaseRevisions)
      .where(eq(t.evalCaseRevisions.caseId, item.id));
    expect(rev!.inputDiff).toContain('+one');
    await app.close();
  });

  it('answers 404 for every id of another workspace and makes no model call (AC25)', async () => {
    const { app, openai } = await appWith();
    const [ws2] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${seq++}` })
      .returning();
    const agent = await addAgent(ws2!.id);
    const pr = await addPr(ws2!.id);
    const { findings } = await addReview(ws2!.id, pr.id, agent.id, [
      { title: 'Foreign', accepted: true },
    ]);
    const [foreignCase] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId: ws2!.id,
        ownerKind: 'agent',
        ownerId: agent.id,
        agentId: agent.id,
        name: 'foreign-case',
      })
      .returning();
    await pg.handle.db.insert(t.evalCaseRevisions).values({
      workspaceId: ws2!.id,
      caseId: foreignCase!.id,
      revision: 1,
      inputDiff: 'diff',
      inputFiles: ['src/a.ts'],
      inputMeta: { pr_title: 't', pr_description: '' },
      expectationType: 'must_find',
      expectation: { file: 'src/a.ts', start_line: 12, end_line: 13 },
    });
    const [foreignRun] = await pg.handle.db
      .insert(t.evalSuiteRuns)
      .values({
        workspaceId: ws2!.id,
        agentId: agent.id,
        status: 'completed',
        agentVersion: 1,
        config: {
          agent_version: 1,
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 's',
          strategy: 'single-pass',
          skills: [],
        },
        cases: [],
        casesTotal: 0,
      })
      .returning();

    const calls: [string, string][] = [
      ['POST', `/findings/${findings[0]!.id}/eval-case`],
      ['GET', `/agents/${agent.id}/eval-cases`],
      ['DELETE', `/eval-cases/${foreignCase!.id}`],
      ['POST', `/agents/${agent.id}/eval-runs`],
      ['GET', `/agents/${agent.id}/eval-runs`],
      ['GET', `/eval-runs/${foreignRun!.id}`],
    ];
    for (const [method, url] of calls) {
      const res = await app.inject({ method: method as 'GET', url });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    const [still] = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.id, foreignCase!.id));
    expect(still).toBeDefined();
    expect(openai.calls).toHaveLength(0);
    await app.close();
  });

  it('deleting the agent removes its cases, their revisions and its runs (AC10)', async () => {
    const { app } = await appWith();
    const agent = await addAgent(workspaceId);
    const pr = await addPr(workspaceId);
    const { findings } = await addReview(workspaceId, pr.id, agent.id, [
      { title: 'Doomed Case', accepted: true },
    ]);
    const created = await app.inject({ method: 'POST', url: `/findings/${findings[0]!.id}/eval-case` });
    const caseId = created.json().case.id as string;
    const [run] = await pg.handle.db
      .insert(t.evalSuiteRuns)
      .values({
        workspaceId,
        agentId: agent.id,
        status: 'completed',
        agentVersion: 1,
        config: {
          agent_version: 1,
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 's',
          strategy: 'single-pass',
          skills: [],
        },
        cases: [],
        casesTotal: 0,
      })
      .returning();

    await pg.handle.db.delete(t.agents).where(eq(t.agents.id, agent.id));

    const cases = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.id, caseId));
    const revs = await pg.handle.db
      .select()
      .from(t.evalCaseRevisions)
      .where(eq(t.evalCaseRevisions.caseId, caseId));
    const runs = await pg.handle.db
      .select()
      .from(t.evalSuiteRuns)
      .where(and(eq(t.evalSuiteRuns.id, run!.id)));
    expect([cases.length, revs.length, runs.length]).toEqual([0, 0, 0]);
    await app.close();
  });
});

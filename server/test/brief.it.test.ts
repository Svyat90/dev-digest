/**
 * `GET|POST /pulls/:id/brief` — against a real Postgres (SPEC-03 AC2, AC3, AC12, AC13, AC18,
 * AC19, AC20 server half, AC26). Every client a generation can reach is overridden: the three
 * LLM providers (the unused ones throw), GitHub, git, repo-intel and the docs reader, so no real
 * network or LLM call is made (server INSIGHTS 2026-09-26).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { PrBrief } from '@devdigest/shared';
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
const d = hasDocker ? describe : describe.skip;
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

const ANSWER = {
  summary: 'Adds a handler and wires it to the API.',
  risks: [
    {
      kind: 'security',
      title: 'Unvalidated input',
      explanation: 'The handler trusts its input.',
      severity: 'high',
      file_refs: [
        { file: 'src/a.ts', start_line: 12, end_line: 18 },
        { file: 'src/made-up.ts', start_line: 3, end_line: null },
        { file: 'src/api.ts', start_line: 3, end_line: null },
      ],
    },
  ],
  review_focus: [{ file: 'src/a.ts', line: 12, reason: 'Start here.' }],
};

const PATCH = '@@ -10,3 +10,9 @@\n ctx\n+one\n+two\n+three\n+four\n+five\n+six\n ctx\n ctx';

const repoIntel = {
  getBlastRadius: async () => ({
    changedSymbols: [{ file: 'src/a.ts', name: 'alpha', kind: 'function' }],
    callers: [{ file: 'src/api.ts', symbol: 'handler', viaSymbol: 'alpha', line: 3, rank: 2 }],
    impactedEndpoints: ['GET /x'],
    factsByFile: { 'src/api.ts': { endpoints: ['GET /x'], crons: [] } },
    degraded: false,
  }),
  getIndexState: async () => ({ status: 'full', lastIndexedSha: 'idx123' }),
} as unknown as RepoIntel;

let seq = 0;

d('brief routes (Testcontainers pg)', () => {
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

  async function appWith(opts: { openai?: LLMProvider; openrouter?: LLMProvider } = {}) {
    const openai = opts.openai ?? new MockLLMProvider('openai', { structuredBySchema: { PrBriefAnswer: ANSWER } });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        repoIntel,
        repoDocs: new MockRepoDocsReader(),
        llm: {
          openai,
          anthropic: new ThrowingLLMProvider('anthropic'),
          openrouter: opts.openrouter ?? new ThrowingLLMProvider('openrouter'),
        },
      },
    });
    return { app, openai };
  }

  async function addPr(wsId: string) {
    const name = `brief-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: wsId, owner: 'acme', name, fullName: `acme/${name}`, clonePath: '/clone' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: wsId,
        repoId: repo!.id,
        number: 700 + seq,
        title: 'Add handler',
        author: 'dev',
        branch: 'feat/b',
        base: 'main',
        headSha: 'shaA',
        additions: 7,
        deletions: 0,
        filesCount: 2,
        status: 'open',
        body: 'Closes #471',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/a.ts', additions: 6, deletions: 0, patch: PATCH },
      { prId: pr!.id, path: 'src/b.ts', additions: 1, deletions: 0, patch: '@@ -1,1 +1,2 @@\n ctx\n+x' },
    ]);
    return pr!;
  }

  it('generates, stores and re-reads a brief; stale head, override, invalid answer, tenancy, old shape', async () => {
    const pr = await addPr(workspaceId);
    const { app, openai } = await appWith();
    const calls = () => (openai as MockLLMProvider).calls.filter((c) => c.method === 'completeStructured');

    // AC18/AC19: nothing stored -> literal null.
    const before = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(before.payload).toBe('null');

    // AC2, AC12, AC18: one call, head SHA recorded, made-up ref dropped.
    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(post.statusCode).toBe(200);
    const brief = post.json();
    expect(() => PrBrief.parse(brief)).not.toThrow();
    expect(brief.head_sha).toBe('shaA');
    const files = brief.risks.risks.flatMap((r: { file_refs: { file: string }[] }) => r.file_refs.map((f) => f.file));
    expect(files).toContain('src/a.ts');
    expect(files).toContain('src/api.ts');
    expect(files).not.toContain('src/made-up.ts');
    expect(calls()).toHaveLength(1);
    expect((calls()[0]!.req as { maxRetries?: number }).maxRetries).toBe(0);

    // AC19: GET returns the stored brief, no new call.
    const again = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(again.json()).toEqual(brief);
    expect(calls()).toHaveLength(1);

    // AC20 (server half): the head moves; the old brief keeps its own SHA, no call.
    await pg.handle.db.update(t.pullRequests).set({ headSha: 'shaB' }).where(eq(t.pullRequests.id, pr.id));
    const stale = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(stale.json().head_sha).toBe('shaA');
    expect(calls()).toHaveLength(1);

    // AC26: another workspace's PR is a 404 on both verbs, no model call.
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-brief' }).returning();
    const foreign = await addPr(otherWs!.id);
    expect((await app.inject({ method: 'GET', url: `/pulls/${foreign.id}/brief` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/pulls/${foreign.id}/brief` })).statusCode).toBe(404);
    expect(calls()).toHaveLength(1);

    // EC19: a row with an old shape reads as null.
    const old = await addPr(workspaceId);
    await pg.handle.db.insert(t.prBrief).values({ prId: old.id, json: { intent: { a: 1 }, risks: {} } });
    expect((await app.inject({ method: 'GET', url: `/pulls/${old.id}/brief` })).payload).toBe('null');
    await app.close();
  });

  it('AC13/AC23: an invalid model answer is a 502 invalid_model_answer and keeps the earlier brief', async () => {
    const pr = await addPr(workspaceId);
    const good = new MockLLMProvider('openai', { structuredBySchema: { PrBriefAnswer: ANSWER } });
    const { app } = await appWith({ openai: good });
    expect((await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).statusCode).toBe(200);
    await app.close();

    const bad = new MockLLMProvider('openai', {
      structuredBySchema: { PrBriefAnswer: { ...ANSWER, risks: [{ ...ANSWER.risks[0], severity: undefined }] } },
    });
    const { app: app2 } = await appWith({ openai: bad });
    const res = await app2.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('invalid_model_answer');
    const kept = await app2.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(kept.json().summary).toBe(ANSWER.summary);
    await app2.close();
  });

  it('AC3: a workspace override of risk_brief routes the call to that provider', async () => {
    const pr = await addPr(workspaceId);
    const openrouter = new MockLLMProvider('openai', { structuredBySchema: { PrBriefAnswer: ANSWER } });
    const { app } = await appWith({ openrouter });
    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { risk_brief: { provider: 'openrouter', model: 'z-ai/glm-4.7-flash' } } },
    });
    expect(put.statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json().provider).toBe('openrouter');
    expect(openrouter.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    await app.close();
  });
});

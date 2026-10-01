/**
 * `GET /pulls/:id/blast` and `GET /pulls/:id/history` — against a real Postgres.
 * Both routes read: the facade is a COUNTING double, git and GitHub are doubles,
 * and every LLM provider THROWS, so any accidental model call fails the request
 * loudly (smart-diff.it.test.ts shape). Rows are inserted directly; no review runs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { BlastRadiusResponse, PrHistoryResponse } from '@devdigest/shared';
import type {
  LLMProvider,
  ModelInfo,
  CompletionResult,
  StructuredResult,
  GitClient,
  GitCommit,
} from '@devdigest/shared';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/domain/repo-intel/limits.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function neverCalled(name: string): never {
  throw new Error(`${name} must never be called by the blast routes`);
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

const COMMITS: Record<string, GitCommit[]> = {
  'src/a.ts': [{ sha: 'sha-old', message: 'old', author: 'dev', date: '2026-01-01T00:00:00Z' }],
};

let seq = 0;

d('blast routes (Testcontainers pg)', () => {
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

  async function setup() {
    const calls: { repoId: string; files: string[] }[] = [];
    const repoIntel = {
      getBlastRadius: async (repoId: string, files: string[]) => {
        calls.push({ repoId, files });
        return {
          changedSymbols: [{ file: 'src/a.ts', name: 'alpha', kind: 'function' }],
          callers: [{ file: 'src/api.ts', symbol: 'handler', viaSymbol: 'alpha', line: 3, rank: 2 }],
          impactedEndpoints: ['GET /x'],
          factsByFile: { 'src/api.ts': { endpoints: ['GET /x'], crons: [] } },
          degraded: false,
        };
      },
      getIndexState: async () => ({ status: 'full', lastIndexedSha: 'idx123' }),
    } as unknown as RepoIntel;
    const git = { log: async (_r: unknown, path?: string) => COMMITS[path ?? ''] ?? [] } as unknown as GitClient;
    const github = new MockGitHubClient({
      pullsForCommit: {
        'sha-old': [
          { number: 11, title: 'Earlier change', author: 'dev', mergedAt: '2026-01-02T00:00:00Z' },
          { number: 12, title: 'Never merged', author: 'dev', mergedAt: null },
        ],
      },
    });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        repoIntel,
        git,
        github,
        llm: {
          openai: new ThrowingLLMProvider('openai'),
          anthropic: new ThrowingLLMProvider('anthropic'),
          openrouter: new ThrowingLLMProvider('openrouter'),
        },
      },
    });
    return { app, calls };
  }

  async function addPr(wsId: string, clonePath: string | null = '/clone') {
    const name = `blast-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: wsId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: wsId,
        repoId: repo!.id,
        number: 500 + seq,
        title: 'Blast test PR',
        author: 'dev',
        branch: 'feat/b',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'open',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({ prId: pr!.id, path: 'src/a.ts', additions: 1, deletions: 0 });
    return { repo: repo!, pr: pr! };
  }

  it('GET /pulls/:id/blast: contract-valid, one facade call with the PR paths, no LLM', async () => {
    const { app, calls } = await setup();
    const { repo, pr } = await addPr(workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = BlastRadiusResponse.parse(res.json());
    expect(body.index_sha).toBe('idx123');
    expect(body.limits.max_callers_per_symbol).toBe(MAX_CALLERS_PER_SYMBOL);
    expect(body.downstream[0]?.endpoints_affected).toEqual(['GET /x']);
    expect(calls).toEqual([{ repoId: repo.id, files: ['src/a.ts'] }]);
    await app.close();
  });

  it('blast is tenancy-scoped (404, facade untouched) and validates the id (422)', async () => {
    const { app, calls } = await setup();
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-blast' }).returning();
    const foreign = await addPr(otherWs!.id);

    expect((await app.inject({ method: 'GET', url: `/pulls/${foreign.pr.id}/blast` })).statusCode).toBe(404);
    expect(calls).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' })).statusCode).toBe(422);
    await app.close();
  });

  it('GET /pulls/:id/history: merged prior PRs only; no_clone when the repo has no clone', async () => {
    const { app } = await setup();
    const { repo, pr } = await addPr(workspaceId);

    const ok = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/history` });
    expect(ok.statusCode).toBe(200);
    const body = PrHistoryResponse.parse(ok.json());
    expect(body.degraded).toBe(false);
    expect(body.history.map((h) => h.pr_number)).toEqual([11]);

    await pg.handle.db.update(t.repos).set({ clonePath: null }).where(eq(t.repos.id, repo.id));
    const none = PrHistoryResponse.parse(
      (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/history` })).json(),
    );
    expect(none).toMatchObject({ degraded: true, reason: 'no_clone', history: [] });
    await app.close();
  });
});

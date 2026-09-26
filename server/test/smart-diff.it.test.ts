/**
 * `GET /pulls/:id/smart-diff` — against a real Postgres. Deterministic and
 * pre-review by design (server INSIGHTS "no enrichment triggered here"): the
 * app is built with a THROWING double for every LLM provider and for GitHub,
 * so any accidental model or GitHub call fails the request loudly instead of
 * quietly succeeding. Reviews/findings are inserted directly (the
 * `pulls-findings.it.test.ts` shape, server INSIGHTS 2026-09-19 "test derived
 * behaviour by inserting rows, not by running a review"), with an increasing
 * `createdAt` clock so "latest per agent" is deterministic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { SmartDiff } from '@devdigest/shared';
import type {
  LLMProvider,
  GitHubClient,
  ModelInfo,
  CompletionResult,
  StructuredResult,
  PrMeta,
  PrDetail,
  PrReviewComment,
  IssueMeta,
} from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Always throws — proves a caller never reached this method. */
function neverCalled(name: string): never {
  throw new Error(`${name} must never be called by GET /pulls/:id/smart-diff`);
}

/**
 * Throws on every method. Used for every provider id ('openai', 'anthropic',
 * 'openrouter') so a container lookup by ANY of them still fails loudly.
 */
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

/** Throws on every method — the smart-diff route never touches GitHub. */
class ThrowingGitHubClient implements GitHubClient {
  listPullRequests(): Promise<PrMeta[]> {
    return neverCalled('GitHubClient.listPullRequests');
  }
  getPullRequest(): Promise<PrDetail> {
    return neverCalled('GitHubClient.getPullRequest');
  }
  postReview(): Promise<{ id: string }> {
    return neverCalled('GitHubClient.postReview');
  }
  listReviewComments(): Promise<PrReviewComment[]> {
    return neverCalled('GitHubClient.listReviewComments');
  }
  createReviewComment(): Promise<PrReviewComment> {
    return neverCalled('GitHubClient.createReviewComment');
  }
  openPullRequest(): Promise<{ url: string }> {
    return neverCalled('GitHubClient.openPullRequest');
  }
  commitFiles(): Promise<{ branch: string }> {
    return neverCalled('GitHubClient.commitFiles');
  }
  findOpenPr(): Promise<{ url: string } | null> {
    return neverCalled('GitHubClient.findOpenPr');
  }
  getIssue(): Promise<IssueMeta> {
    return neverCalled('GitHubClient.getIssue');
  }
  currentLogin(): Promise<string> {
    return neverCalled('GitHubClient.currentLogin');
  }
}

let repoSeq = 0;
async function setupRepo(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `smart-diff-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  return repo!;
}

let prSeq = 0;
async function addPr(db: PgFixture['handle']['db'], workspaceId: string, repoId: string) {
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number: 500 + prSeq++,
      title: 'Smart diff test PR',
      author: 'marisa.koch',
      branch: 'feat/sd',
      base: 'main',
      headSha: 'deadbeef',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  return pr!;
}

/** Inserts `pr_files` rows; each defaults to 1 addition / 0 deletions unless overridden. */
async function addFiles(
  db: PgFixture['handle']['db'],
  prId: string,
  files: { path: string; additions?: number; deletions?: number }[],
) {
  await db.insert(t.prFiles).values(
    files.map((f) => ({
      prId,
      path: f.path,
      additions: f.additions ?? 1,
      deletions: f.deletions ?? 0,
    })),
  );
}

d('GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
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

  let agentA: string;
  let agentB: string;
  beforeAll(async () => {
    const rows = await pg.handle.db
      .insert(t.agents)
      .values(
        ['Smart Diff Agent A', 'Smart Diff Agent B'].map((name) => ({
          workspaceId,
          name,
          provider: 'openai' as const,
          model: 'test',
          systemPrompt: 'test',
        })),
      )
      .returning();
    agentA = rows[0]!.id;
    agentB = rows[1]!.id;
  });

  /** Reviews are inserted oldest-first; an explicit, increasing timestamp keeps "latest" deterministic. */
  let clock = Date.UTC(2026, 0, 1);

  async function addReview(prId: string, agentId: string | null) {
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'seeded by the test',
        score: 61,
        model: 'test',
        createdAt: new Date((clock += 60_000)),
      })
      .returning();
    return review!;
  }

  async function addFinding(
    reviewId: string,
    file: string,
    startLine: number,
    extra: Partial<typeof t.findings.$inferInsert> = {},
  ) {
    await pg.handle.db.insert(t.findings).values({
      reviewId,
      file,
      startLine,
      endLine: startLine,
      severity: 'WARNING',
      category: 'security',
      title: 'seeded finding',
      rationale: 'because',
      confidence: 0.9,
      ...extra,
    });
  }

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        github: new ThrowingGitHubClient(),
        llm: {
          openai: new ThrowingLLMProvider('openai'),
          anthropic: new ThrowingLLMProvider('anthropic'),
          openrouter: new ThrowingLLMProvider('openrouter'),
        },
      },
    });
  }

  it('pre-review: groups all five roles, empty finding_lines, and never reaches the LLM/GitHub doubles', async () => {
    const app = await appWith();
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await addPr(pg.handle.db, workspaceId, repo.id);
    await addFiles(pg.handle.db, pr.id, [
      { path: 'src/config.ts' }, // core
      { path: 'src/a.test.ts' }, // tests
      { path: '.env.example' }, // wiring
      { path: 'docs/x.md' }, // docs
      { path: 'pnpm-lock.yaml' }, // boilerplate
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    // A 200 here already proves neither throwing double was reached: either one
    // being called would have failed the request instead of returning a body.
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.groups.map((g: { role: string }) => g.role)).toEqual([
      'core',
      'tests',
      'wiring',
      'docs',
      'boilerplate',
    ]);
    const boilerplate = body.groups.find((g: { role: string }) => g.role === 'boilerplate');
    expect(boilerplate.files.map((f: { path: string }) => f.path)).toEqual(['pnpm-lock.yaml']);
    for (const group of body.groups) {
      for (const file of group.files) {
        expect(file.finding_lines).toEqual([]);
      }
    }
    expect(body.split_suggestion).toEqual({ too_big: false, total_lines: 5, proposed_splits: [] });
    expect(() => SmartDiff.parse(body)).not.toThrow();

    await app.close();
  });

  it("finding_lines counts each agent's latest review only, dedupes, and drops dismissed", async () => {
    const app = await appWith();
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await addPr(pg.handle.db, workspaceId, repo.id);
    await addFiles(pg.handle.db, pr.id, [{ path: 'src/config.ts' }]);

    // Agent A: an OLD review (line 3) superseded by a NEW review (lines 9, 9
    // duplicate, and a dismissed line 4) — only the new review's open lines count.
    const oldA = await addReview(pr.id, agentA);
    await addFinding(oldA.id, 'src/config.ts', 3);
    const newA = await addReview(pr.id, agentA);
    await addFinding(newA.id, 'src/config.ts', 9);
    await addFinding(newA.id, 'src/config.ts', 9);
    await addFinding(newA.id, 'src/config.ts', 4, { dismissedAt: new Date() });

    // Agent B: one review, one open finding on line 1.
    const b = await addReview(pr.id, agentB);
    await addFinding(b.id, 'src/config.ts', 1);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const core = body.groups.find((g: { role: string }) => g.role === 'core');
    expect(core.files[0].finding_lines).toEqual([1, 9]);

    await app.close();
  });

  it('omits empty groups: only a core file and a docs file yields exactly core, docs', async () => {
    const app = await appWith();
    const repo = await setupRepo(pg.handle.db, workspaceId);
    const pr = await addPr(pg.handle.db, workspaceId, repo.id);
    await addFiles(pg.handle.db, pr.id, [{ path: 'src/a.ts' }, { path: 'README.md' }]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    expect(res.json().groups.map((g: { role: string }) => g.role)).toEqual(['core', 'docs']);

    await app.close();
  });

  it('is tenancy-scoped (404 for another workspace) and validates the id (422 for a non-uuid)', async () => {
    const app = await appWith();
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-smart-diff' }).returning();
    const otherRepo = await setupRepo(pg.handle.db, otherWs!.id);
    const foreignPr = await addPr(pg.handle.db, otherWs!.id, otherRepo.id);

    const foreign = await app.inject({ method: 'GET', url: `/pulls/${foreignPr.id}/smart-diff` });
    expect(foreign.statusCode).toBe(404);

    const invalid = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/smart-diff' });
    expect(invalid.statusCode).toBe(422);

    await app.close();
  });
});

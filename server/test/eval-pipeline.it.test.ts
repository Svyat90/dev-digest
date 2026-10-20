/**
 * Eval pipeline end to end — against a real Postgres (SPEC-04 AC1, AC6, AC18, AC27). Findings are
 * turned into cases over HTTP (>= 8, both expectation types), the set is run twice with two system
 * prompts, and a scripted model decides its findings from the SYSTEM message, so recall and
 * precision differ between the runs. No real model call: every provider is a double, and the
 * scripted one counts its requests to prove that scoring makes none.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type {
  LLMProvider,
  ModelInfo,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import {
  MockGitClient,
  MockGitHubClient,
  MockRepoDocsReader,
} from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
// `verify:l06` sets EVAL_IT_REQUIRED=1 so a missing Docker fails instead of skipping (A11).
const d = hasDocker || process.env.EVAL_IT_REQUIRED === '1' ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const PROMPT_A = 'PROMPT-A: report every defect on the lines that matter.';
const PROMPT_B = 'PROMPT-B: report the style nits and cite lines freely.';
const MUST_FIND = 5;
const MUST_NOT_FLAG = 3;
const FILES = Array.from({ length: MUST_FIND + MUST_NOT_FLAG }, (_, i) => `src/f${i}.ts`);

/** New lines 10..18 of the file. */
const PATCH = '@@ -10,3 +10,9 @@\n ctx\n+one\n+two\n+three\n+four\n+five\n+six\n ctx\n ctx';

const neverCalled = (name: string): never => {
  throw new Error(`${name} must never be called by this test`);
};

/**
 * Scripted model. The behaviour is chosen by the system message: prompt A cites the expected range
 * of the `must_find` files and nothing on the others; prompt B cites the `must_not_flag` ranges
 * and, for the `must_find` files, a line outside the diff (dropped by grounding). The file under
 * review comes from the user message, the only place the diff is.
 */
class ScriptedLLMProvider implements LLMProvider {
  readonly id = 'openai' as const;
  calls = 0;
  async listModels(): Promise<ModelInfo[]> {
    return neverCalled('listModels');
  }
  async complete(): Promise<CompletionResult> {
    return neverCalled('complete');
  }
  async embed(): Promise<number[][]> {
    return neverCalled('embed');
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls += 1;
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const user = req.messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n');
    const file = FILES.find((f) => user.includes(f));
    const idx = file ? FILES.indexOf(file) : -1;
    const mustFind = idx >= 0 && idx < MUST_FIND;
    const finding = (start: number, end: number) => ({
      id: `f-${idx}-${start}`,
      severity: 'WARNING',
      category: 'bug',
      title: 'Scripted finding',
      file,
      start_line: start,
      end_line: end,
      rationale: 'Because.',
      confidence: 0.9,
    });
    let findings: unknown[] = [];
    if (file && system.includes('PROMPT-A') && mustFind) findings = [finding(12, 13)];
    if (file && system.includes('PROMPT-B')) findings = [mustFind ? finding(200, 201) : finding(12, 13)];
    const fixture = { verdict: 'comment', summary: 's', score: 80, findings };
    const parsed = (req.schema as { parse(v: unknown): T }).parse(fixture);
    return {
      data: parsed,
      model: req.model,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
      raw: JSON.stringify(fixture),
      attempts: 1,
    };
  }
}

class ThrowingLLMProvider implements LLMProvider {
  constructor(readonly id: 'openai' | 'anthropic' | 'openrouter') {}
  async listModels(): Promise<ModelInfo[]> {
    return neverCalled(`LLMProvider(${this.id}).listModels`);
  }
  async complete(): Promise<CompletionResult> {
    return neverCalled(`LLMProvider(${this.id}).complete`);
  }
  async completeStructured<T>(): Promise<StructuredResult<T>> {
    return neverCalled(`LLMProvider(${this.id}).completeStructured`);
  }
  async embed(): Promise<number[][]> {
    return neverCalled(`LLMProvider(${this.id}).embed`);
  }
}

d('eval pipeline (Testcontainers pg)', () => {
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

  it('runs >= 8 one-click cases twice with two prompts and scores without a model (AC1, AC6, AC18, AC27)', async () => {
    const scripted = new ScriptedLLMProvider();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        repoIntel: {} as unknown as RepoIntel,
        repoDocs: new MockRepoDocsReader(),
        llm: {
          openai: scripted,
          anthropic: new ThrowingLLMProvider('anthropic'),
          openrouter: new ThrowingLLMProvider('openrouter'),
        },
      },
    });

    const createdAgent = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: 'eval-pipeline-agent', provider: 'openai', model: 'gpt-4.1', system_prompt: PROMPT_A },
    });
    expect(createdAgent.statusCode).toBe(201);
    const agentId = createdAgent.json().id as string;

    // Seed one PR with 8 patched files and one review by that agent with 8 findings.
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'eval-pipeline', fullName: 'acme/eval-pipeline', clonePath: '/clone' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 4242,
        title: 'Add handlers',
        author: 'dev',
        branch: 'feat/e',
        base: 'main',
        headSha: 'shaP',
        additions: FILES.length,
        deletions: 0,
        filesCount: FILES.length,
        status: 'open',
        body: 'Adds handlers.',
      })
      .returning();
    await pg.handle.db
      .insert(t.prFiles)
      .values(FILES.map((path) => ({ prId: pr!.id, path, additions: 1, deletions: 0, patch: PATCH })));
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr!.id, agentId, kind: 'review', model: 'gpt-4.1' })
      .returning();
    const findings = await pg.handle.db
      .insert(t.findings)
      .values(
        FILES.map((file, i) => ({
          reviewId: review!.id,
          file,
          startLine: 12,
          endLine: 13,
          severity: 'WARNING',
          category: 'bug',
          title: `Finding number ${i}`,
          rationale: 'Because.',
          confidence: 0.8,
          kind: 'finding',
        })),
      )
      .returning();
    const byFile = new Map(findings.map((f) => [f.file, f.id]));

    // Decide: accept the first five, dismiss the last three, then one click each.
    for (const [i, file] of FILES.entries()) {
      const action = i < MUST_FIND ? 'accept' : 'dismiss';
      const decided = await app.inject({ method: 'POST', url: `/findings/${byFile.get(file)}/${action}` });
      expect(decided.statusCode).toBe(200);
    }
    const caseIds: string[] = [];
    const types: string[] = [];
    for (const file of FILES) {
      const res = await app.inject({ method: 'POST', url: `/findings/${byFile.get(file)}/eval-case` });
      expect(res.statusCode).toBe(201);
      caseIds.push(res.json().case.id);
      types.push(res.json().case.expectation_type);
    }
    expect(caseIds.length).toBeGreaterThanOrEqual(8);
    expect(types.filter((x) => x === 'must_find')).toHaveLength(MUST_FIND);
    expect(types.filter((x) => x === 'must_not_flag')).toHaveLength(MUST_NOT_FLAG);

    // AC6: every finding of the review reports the case it produced.
    const reviews = await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/reviews` });
    const dto = reviews.json()[0].findings as { id: string; eval_case_id?: string | null }[];
    expect(dto.filter((f) => f.eval_case_id).length).toBe(FILES.length);

    async function runAndWait(): Promise<{
      id: string;
      status: string;
      recall: number | null;
      precision: number | null;
      citation_accuracy: number | null;
      config: { system_prompt: string };
      cases: { case_id: string; revision_id: string; revision: number }[];
    }> {
      const started = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
      expect(started.statusCode).toBe(202);
      const runId = started.json().run_id as string;
      const deadline = Date.now() + 30_000;
      for (;;) {
        const res = await app.inject({ method: 'GET', url: `/eval-runs/${runId}` });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        if (body.status !== 'running') return body;
        if (Date.now() > deadline) throw new Error(`eval run ${runId} still running after 30s`);
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const runA = await runAndWait();
    expect(runA.status).toBe('completed');

    const updated = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}`,
      payload: { system_prompt: PROMPT_B },
    });
    expect(updated.statusCode).toBe(200);

    const runB = await runAndWait();
    expect(runB.status).toBe('completed');

    expect(runA.config.system_prompt).toBe(PROMPT_A);
    expect(runB.config.system_prompt).toBe(PROMPT_B);
    expect(runA.recall).toBe(1);
    expect(runB.recall).toBe(0);
    expect(runA.precision).not.toBe(runB.precision);
    expect(runA.citation_accuracy).not.toBe(runB.citation_accuracy);

    // No edit happened: both runs cover the same cases at the same revisions.
    const key = (r: typeof runA) =>
      r.cases.map((c) => `${c.case_id}:${c.revision_id}:${c.revision}`).sort();
    expect(key(runA)).toEqual(key(runB));
    expect(runA.cases.map((c) => c.case_id).sort()).toEqual([...caseIds].sort());

    // AC18 / AC27: exactly one model request per case per run, none from scoring.
    expect(scripted.calls).toBe(caseIds.length * 2);

    await app.close();
  });
});

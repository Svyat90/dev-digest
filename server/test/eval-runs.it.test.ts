/**
 * Eval run lifecycle — against a real Postgres (SPEC-04 AC8, AC9, AC11–AC17; SPEC-06 AC12 shape).
 * The agent's model is a scripted `openai` provider (counts calls, records every request, can
 * block on a gate or throw per case); `anthropic` / `openrouter` throw, GitHub / git / repo-intel /
 * docs are mocked, so no real network or LLM call is made (server INSIGHTS 2026-09-26).
 *
 * Cases are inserted directly (case + revision 1) with a marker line in the frozen diff; the
 * scripted provider decides what to do from that marker. Reaping rows are inserted AFTER the first
 * `buildApp()` and a second one triggers the reaper (server INSIGHTS 2026-09-29).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
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

/**
 * Scripted agent model. Behaviour per request is chosen by the marker line inside the frozen diff:
 * `MARK_FIND` returns one finding on lines 11..12, `MARK_BOOM` throws, anything else returns none.
 */
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
    if (text.includes('MARK_BOOM')) throw new Error('scripted model failure');
    const findings = text.includes('MARK_FIND')
      ? [
          {
            id: 'f1',
            severity: 'WARNING',
            category: 'bug',
            title: 'Scripted finding',
            file: 'src/a.ts',
            start_line: 11,
            end_line: 12,
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

/** Wraps a mock so any method call is recorded: no eval path may reach GitHub or git (AC13). */
function recorded<T extends object>(target: T, calls: string[]): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.push(String(prop));
        return (value as (...a: unknown[]) => unknown).apply(obj, args);
      };
    },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

/** Self-contained frozen diff; new lines 10..14, the marker is new line 11. */
function frozen(tag: string): string {
  return [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,3 +10,5 @@',
    ' ctx',
    `+// MARK_${tag}`,
    '+two',
    ' ctx',
    ' ctx',
  ].join('\n');
}

d('eval runs lifecycle (Testcontainers pg)', () => {
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
    const outside: string[] = [];
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: recorded(new MockGitClient(), outside),
        github: recorded(new MockGitHubClient(), outside),
        repoIntel: {} as unknown as RepoIntel,
        repoDocs: new MockRepoDocsReader(),
        llm: {
          openai: llm,
          anthropic: new ThrowingLLMProvider('anthropic'),
          openrouter: new ThrowingLLMProvider('openrouter'),
        },
      },
    });
    outside.length = 0; // boot work is not under test; only what a run does
    return { app, llm, outside };
  }

  async function addAgent() {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `run-agent-${seq++}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review the diff.',
      })
      .returning();
    return agent!;
  }

  async function addSkill(label: string) {
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: `skill-${label}-${seq++}`,
        description: `About ${label}`,
        type: 'custom',
        source: 'manual',
        body: `Rule text of ${label}.`,
      })
      .returning();
    return skill!;
  }

  /** A case with its revision 1, inserted directly; distinct names within the agent's set. */
  async function addCase(
    agentId: string,
    tag: 'FIND' | 'QUIET' | 'BOOM',
    expectationType: 'must_find' | 'must_not_flag' = 'must_find',
  ) {
    const [row] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        agentId,
        name: `case-${tag.toLowerCase()}-${seq++}`,
        provenance: {
          finding_id: randomUUID(),
          review_id: randomUUID(),
          pr_id: randomUUID(),
          pr_number: 7,
          repo_id: randomUUID(),
          repo_full_name: 'acme/run',
          decision: 'accepted',
          decided_at: new Date().toISOString(),
          agent_version: 1,
          severity: 'WARNING',
          category: 'bug',
          title: 'Scripted finding',
        },
      })
      .returning();
    const expectation = { file: 'src/a.ts', start_line: 11, end_line: 12 };
    const [rev] = await pg.handle.db
      .insert(t.evalCaseRevisions)
      .values({
        workspaceId,
        caseId: row!.id,
        revision: 1,
        inputDiff: frozen(tag),
        inputFiles: ['src/a.ts'],
        inputMeta: { pr_title: 'Add handler', pr_description: 'Adds a handler.' },
        expectationType,
        expectation,
      })
      .returning();
    return { case: row!, revision: rev!, expectation };
  }

  const detailOf = async (app: FastifyInstance, runId: string) =>
    (await app.inject({ method: 'GET', url: `/eval-runs/${runId}` })).json();

  /** Polls until the run leaves `running`, then ASSERTS it is terminal (server INSIGHTS 2026-09-19). */
  async function waitTerminal(app: FastifyInstance, runId: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    let run = await detailOf(app, runId);
    while (run.status === 'running' && Date.now() < deadline) {
      await sleep(50);
      run = await detailOf(app, runId);
    }
    expect(['completed', 'failed']).toContain(run.status);
    return run;
  }

  async function startRun(app: FastifyInstance, agentId: string) {
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    return { res, runId: res.statusCode === 202 ? (res.json().run_id as string) : '' };
  }

  it(
    'answers before any case, refuses a second start, snapshots config and revisions, sends only the frozen input (AC11–AC15, AC13, AC14)',
    async () => {
      const { app, llm, outside } = await appWith();
      const agent = await addAgent();
      const skillA = await addSkill('a');
      const skillB = await addSkill('b');
      const c1 = await addCase(agent.id, 'FIND');
      const c2 = await addCase(agent.id, 'QUIET', 'must_not_flag');
      const c3 = await addCase(agent.id, 'QUIET');
      const link = (ids: string[]) =>
        app.inject({
          method: 'PUT',
          url: `/agents/${agent.id}/skills`,
          payload: { items: ids.map((id) => ({ skill_id: id, enabled: true })) },
        });
      expect((await link([skillA.id])).statusCode).toBe(200);

      const release = llm.block();
      const { res, runId } = await startRun(app, agent.id);
      expect(res.statusCode).toBe(202);
      expect(runId).not.toBe('');

      // AC11: the run exists and is running while no case has finished.
      const running = await detailOf(app, runId);
      expect(running.status).toBe('running');
      expect(running.cases_done).toBe(0);
      expect(running.cases_total).toBe(3);

      // AC12: a second start is refused while one runs.
      const second = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
      expect(second.statusCode).toBe(409);
      expect(JSON.stringify(second.json())).toContain('eval_run_in_progress');

      // AC14: edits during the run do not touch what it recorded.
      const edit = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'A completely different prompt.' },
      });
      expect(edit.statusCode).toBe(200);
      expect((await link([skillB.id, skillA.id])).statusCode).toBe(200);

      release();
      const done = await waitTerminal(app, runId);
      expect(done.status).toBe('completed');
      expect(done.cases_done).toBe(done.cases_total); // AC15
      expect(done.config.system_prompt).toBe('Review the diff.');
      expect(done.config.skills.map((s: { id: string }) => s.id)).toEqual([skillA.id]);
      expect(done.config.skills[0]).toMatchObject({ version: 1, order: 0, body: skillA.body });

      // SPEC-06 AC12 shape: every covered case with the revision the case list reports.
      const list = (
        await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` })
      ).json() as { id: string; revision_id: string; revision: number; latest_result: any }[];
      expect(list).toHaveLength(3);
      const refs = done.cases as { case_id: string; revision_id: string; revision: number }[];
      for (const item of list) {
        expect(refs).toContainEqual({
          case_id: item.id,
          revision_id: item.revision_id,
          revision: item.revision,
        });
        const result = done.results.find((r: { case_id: string }) => r.case_id === item.id);
        expect(result.case_revision_id).toBe(item.revision_id);
        // AC8: the list shows each case's latest completed result.
        expect(item.latest_result.case_revision_id).toBe(item.revision_id);
        expect(item.latest_result.eval_run_id).toBe(runId);
      }
      const byId = (id: string) => list.find((i) => i.id === id)!;
      expect(byId(c1.case.id).latest_result.status).toBe('passed');
      expect(byId(c2.case.id).latest_result.status).toBe('passed');
      expect(byId(c3.case.id).latest_result.expected).toBe(1);

      // AC13: the prompt carries the frozen diff and none of the enrichment sections.
      expect(llm.requests.length).toBeGreaterThanOrEqual(3);
      for (const messages of llm.requests) {
        const text = messages.map((m) => m.content).join('\n');
        expect(text).toContain('MARK_');
        expect(text).toContain('## Diff to review');
        for (const heading of [
          '## Repo skeleton',
          '## Project context',
          '## PR intent',
          '## Relevant memory',
          '## Callers of changed symbols',
        ]) {
          expect(text).not.toContain(heading);
        }
      }
      expect(outside).toEqual([]);

      // A later run records the new prompt and the new ordered skill list (EC10, EC11).
      const next = await startRun(app, agent.id);
      expect(next.res.statusCode).toBe(202);
      const second2 = await waitTerminal(app, next.runId);
      expect(second2.config.system_prompt).toBe('A completely different prompt.');
      expect(
        second2.config.skills.map((s: { id: string; order: number }) => [s.id, s.order]),
      ).toEqual([
        [skillB.id, 0],
        [skillA.id, 1],
      ]);
      expect(second2.agent_version).toBeGreaterThan(done.agent_version);

      // A case added after the run is "never run" in the list until a run covers it (EC19).
      const late = await addCase(agent.id, 'QUIET');
      const after = (
        await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` })
      ).json() as { id: string; latest_result: unknown }[];
      expect(after.find((i) => i.id === late.case.id)!.latest_result).toBeNull();

      await app.close();
    },
    60_000,
  );

  it(
    'refuses a run with no cases (AC12)',
    async () => {
      const { app, llm } = await appWith();
      const agent = await addAgent();
      const { res } = await startRun(app, agent.id);
      expect(res.statusCode).toBe(422);
      expect(JSON.stringify(res.json())).toContain('no_eval_cases');
      expect(llm.requests).toHaveLength(0);
      await app.close();
    },
    30_000,
  );

  it(
    'excludes an errored case with its reason; a run where every case errors is failed with null metrics (AC16, EC16)',
    async () => {
      const { app } = await appWith();
      const agent = await addAgent();
      await addCase(agent.id, 'FIND');
      const boom = await addCase(agent.id, 'BOOM');

      const first = await startRun(app, agent.id);
      const mixed = await waitTerminal(app, first.runId);
      expect(mixed.status).toBe('completed');
      expect(mixed.cases_total).toBe(2);
      expect(mixed.cases_scored).toBe(1);
      expect(mixed.recall).toBe(1);
      const errored = mixed.results.find((r: { case_id: string }) => r.case_id === boom.case.id);
      expect(errored.status).toBe('errored');
      expect(errored.error).toContain('scripted model failure');
      expect(errored.findings_returned).toBeNull();

      const solo = await addAgent();
      await addCase(solo.id, 'BOOM');
      await addCase(solo.id, 'BOOM');
      const run = await startRun(app, solo.id);
      const failed = await waitTerminal(app, run.runId);
      expect(failed.status).toBe('failed');
      expect(failed.cases_scored).toBe(0);
      expect(failed.recall).toBeNull();
      expect(failed.precision).toBeNull();
      expect(failed.citation_accuracy).toBeNull();
      expect(failed.cost_usd).toBeNull();
      await app.close();
    },
    60_000,
  );

  it(
    'reaps a run left running: scored result -> completed, none -> failed; a new start then succeeds (AC17, EC20)',
    async () => {
      const first = await appWith();
      const withResult = await addAgent();
      const noResult = await addAgent();
      const a = await addCase(withResult.id, 'FIND');
      const b = await addCase(noResult.id, 'FIND');
      const config = {
        agent_version: 1,
        provider: 'openai' as const,
        model: 'gpt-4.1',
        system_prompt: 's',
        strategy: 'single-pass' as const,
        skills: [],
      };
      const insertRunning = async (agentId: string, c: typeof a) => {
        const [run] = await pg.handle.db
          .insert(t.evalSuiteRuns)
          .values({
            workspaceId,
            agentId,
            status: 'running',
            agentVersion: 1,
            config,
            cases: [{ case_id: c.case.id, revision_id: c.revision.id, revision: 1 }],
            casesTotal: 1,
          })
          .returning();
        return run!;
      };
      const runA = await insertRunning(withResult.id, a);
      const runB = await insertRunning(noResult.id, b);
      await pg.handle.db.insert(t.evalRuns).values({
        workspaceId,
        suiteRunId: runA.id,
        caseId: a.case.id,
        caseRevisionId: a.revision.id,
        caseName: a.case.name,
        status: 'passed',
        expectationType: 'must_find',
        expectation: a.expectation,
        findingsReturned: 1,
        findingsGrounded: 1,
        findingsMatching: 1,
        pass: true,
        recall: 1,
        precision: 1,
        citationAccuracy: 1,
        costUsd: 0.01,
      });
      await first.app.close();

      // The second boot is the reaper's trigger.
      const second = await appWith();
      const closedA = await detailOf(second.app, runA.id);
      const closedB = await detailOf(second.app, runB.id);
      expect(closedA.status).toBe('completed');
      expect(closedA.cases_scored).toBe(1);
      expect(closedA.cases_passed).toBe(1);
      expect(closedA.finished_at).not.toBeNull();
      expect(closedA.duration_ms).not.toBeNull();
      expect(closedB.status).toBe('failed');
      expect(closedB.cases_scored).toBe(0);

      const next = await startRun(second.app, noResult.id);
      expect(next.res.statusCode).toBe(202);
      expect((await waitTerminal(second.app, next.runId)).status).toBe('completed');
      await second.app.close();
    },
    60_000,
  );

  it(
    'a deleted case keeps its past result and the run totals; later runs skip it (AC9, EC18)',
    async () => {
      const { app } = await appWith();
      const agent = await addAgent();
      const keep = await addCase(agent.id, 'FIND');
      const gone = await addCase(agent.id, 'QUIET', 'must_not_flag');

      const first = await startRun(app, agent.id);
      const before = await waitTerminal(app, first.runId);
      expect(before.status).toBe('completed');

      const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${gone.case.id}` });
      expect(del.statusCode).toBe(200);

      const after = await detailOf(app, first.runId);
      expect(after.cases_total).toBe(before.cases_total);
      expect(after.cases_passed).toBe(before.cases_passed);
      expect(after.recall).toBe(before.recall);
      expect(after.precision).toBe(before.precision);
      expect(after.cases).toEqual(before.cases);
      expect(after.cases).toContainEqual({
        case_id: gone.case.id,
        revision_id: gone.revision.id,
        revision: 1,
      });
      const orphan = after.results.find((r: { case_name: string }) => r.case_name === gone.case.name);
      expect(orphan.case_id).toBeNull();
      expect(orphan.case_revision_id).toBeNull();
      expect(orphan.status).toBe('passed');

      const rows = await pg.handle.db
        .select()
        .from(t.evalRuns)
        .where(inArray(t.evalRuns.caseName, [gone.case.name]));
      expect(rows).toHaveLength(1);
      const [keptCase] = await pg.handle.db
        .select()
        .from(t.evalCases)
        .where(eq(t.evalCases.id, keep.case.id));
      expect(keptCase).toBeDefined();

      const second = await startRun(app, agent.id);
      const later = await waitTerminal(app, second.runId);
      expect(later.cases_total).toBe(1);
      expect(later.cases.map((c: { case_id: string }) => c.case_id)).toEqual([keep.case.id]);
      await app.close();
    },
    60_000,
  );
});

import { describe, expect, it } from 'vitest';
import type {
  EvalCaseCheck,
  EvalCaseDraft,
  EvalCaseLastRun,
  EvalCaseListItem,
  EvalCaseOwner,
  EvalCaseProvenance,
} from '@devdigest/shared';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { AppError, ConfigError, NotFoundError } from '../src/platform/errors.js';
import { EvalCaseService, type EvalCaseDeps } from '../src/modules/evals/case-service.js';
import type {
  CaseUpdate,
  CaseUpdateOutcome,
  CheckFinish,
  CheckStart,
  NewManualCase,
  StoredCaseView,
} from '../src/modules/evals/editor-types.js';
import type { RunConfigPorts } from '../src/modules/evals/run-executor.js';
import type { AgentConfigSource, CaseForRun } from '../src/modules/evals/types.js';

const WS = 'ws1';
const AGENT: EvalCaseOwner = { kind: 'agent', id: 'a1' };
const DIFF =
  'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n' +
  '@@ -10,2 +10,3 @@\n   port: 3000,\n+  stripeKey: "x",\n   redisUrl: y,';

const logger = { info: () => {}, warn: () => {}, error: () => {} };

function draft(over: Partial<EvalCaseDraft> = {}): EvalCaseDraft {
  return {
    name: 'hardcoded-key',
    input_diff: DIFF,
    pr_title: 'Add stripe key',
    pr_description: 'Wires the payment key',
    expectation_type: 'must_not_flag',
    expectation: { file: 'src/config.ts', start_line: 11, end_line: 11 },
    expected_output_json: '[]',
    ...over,
  };
}

const PROVENANCE: EvalCaseProvenance = {
  finding_id: 'f1',
  review_id: 'r1',
  pr_id: 'p1',
  pr_number: 7,
  repo_id: 'repo1',
  repo_full_name: 'o/n',
  decision: 'accepted',
  decided_at: '2026-10-01T00:00:00.000Z',
  agent_version: 1,
  severity: 'WARNING',
  category: 'security',
  title: 'Hardcoded key',
};

function view(over: { id?: string; name?: string; provenance?: EvalCaseProvenance | null } = {}): StoredCaseView {
  const d = draft();
  return {
    stored: {
      id: over.id ?? 'c1',
      owner: AGENT,
      name: over.name ?? d.name,
      provenance: over.provenance ?? null,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      revisionId: 'rev1',
      revision: 1,
      content: {
        inputDiff: d.input_diff,
        inputFiles: ['src/config.ts'],
        inputMeta: { pr_title: d.pr_title, pr_description: d.pr_description },
        expectationType: d.expectation_type,
        expectation: d.expectation,
        expectedOutput: over.provenance ? null : [],
      },
    },
    latestResult: null,
    runResult: null,
    check: null,
  };
}

const REVIEW = {
  verdict: 'comment',
  summary: 's',
  score: 80,
  findings: [
    {
      id: 'x1',
      severity: 'WARNING',
      category: 'bug',
      title: 'hardcoded key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'r',
      confidence: 0.9,
    },
  ],
};

type CasePort = EvalCaseDeps['cases'];

class FakeCases implements CasePort {
  owners = new Set(['a1']);
  views = new Map<string, StoredCaseView>();
  inserted: NewManualCase[] = [];
  updates: CaseUpdate[] = [];
  insertAnswer: string | null = 'c-new';
  updateAnswer: CaseUpdateOutcome | null = null;
  checkAnswer: string | null = 'chk1';
  starts: CheckStart[] = [];
  finished: { id: string; values: CheckFinish }[] = [];
  private onFinish: ((v: CheckFinish) => void) | null = null;
  readonly finishedOnce = new Promise<CheckFinish>((resolve) => {
    this.onFinish = resolve;
  });

  async ownerName(_ws: string, owner: EvalCaseOwner) {
    return this.owners.has(owner.id) ? 'Agent' : undefined;
  }
  async caseNames() {
    return [...this.views.values()].map((v) => ({ id: v.stored.id, name: v.stored.name }));
  }
  async listCases(): Promise<EvalCaseListItem[]> {
    return [];
  }
  async getCase(_ws: string, _owner: EvalCaseOwner, caseId: string) {
    return this.views.get(caseId);
  }
  async insertManualCase(values: NewManualCase) {
    this.inserted.push(values);
    if (this.insertAnswer) this.views.set(this.insertAnswer, view({ id: this.insertAnswer, name: values.name }));
    return this.insertAnswer;
  }
  async updateCase(values: CaseUpdate): Promise<CaseUpdateOutcome> {
    this.updates.push(values);
    return this.updateAnswer ?? (values.content ? 'revised' : 'renamed');
  }
  async caseForRun(_ws: string, _owner: EvalCaseOwner, caseId: string): Promise<CaseForRun | undefined> {
    const v = this.views.get(caseId);
    if (!v) return undefined;
    return {
      id: v.stored.id,
      revisionId: v.stored.revisionId,
      revision: v.stored.revision,
      name: v.stored.name,
      expectationType: 'must_find',
      expectation: v.stored.content.expectation,
      inputDiff: v.stored.content.inputDiff,
      inputMeta: v.stored.content.inputMeta,
    };
  }
  async startCheck(values: CheckStart) {
    this.starts.push(values);
    return this.checkAnswer;
  }
  async finishCheck(id: string, values: CheckFinish) {
    this.finished.push({ id, values });
    this.onFinish?.(values);
  }
  async failRunningChecks(_reason: string, _at: Date) {
    return 2;
  }
}

const SOURCE: AgentConfigSource = {
  agent: {
    id: 'a1',
    name: 'Agent',
    version: 4,
    provider: 'openai',
    model: 'm',
    systemPrompt: 'sp',
    strategy: 'single-pass',
  },
  skills: [],
};

const ports: RunConfigPorts = {
  agentConfigSource: async (_ws, agentId) => (agentId === 'a1' ? SOURCE : undefined),
  skillForRun: async () => undefined,
  evalAgent: async () => undefined,
};

function setup(llm: EvalCaseDeps['runner']['llm'] = async () => new MockLLMProvider('openai', { structured: REVIEW })) {
  const cases = new FakeCases();
  let llmCalls = 0;
  const service = new EvalCaseService({
    cases,
    config: ports,
    runner: {
      llm: async (p) => {
        llmCalls += 1;
        return llm(p);
      },
      parseDiff: parseUnifiedDiff,
      tokenizer: { count: (s) => s.length },
      promptLogMode: 'off',
    },
    now: () => new Date('2026-10-13T00:00:00.000Z'),
  });
  return { cases, service, llmCalls: () => llmCalls };
}

async function refusal(p: Promise<unknown>): Promise<AppError> {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe('EvalCaseService.createCase', () => {
  it('stores a valid draft exactly as entered, with revision 1', async () => {
    const { cases, service } = setup();
    const res = await service.createCase(WS, AGENT, draft());
    expect(cases.inserted).toHaveLength(1);
    expect(cases.inserted[0]).toMatchObject({
      workspaceId: WS,
      owner: AGENT,
      name: 'hardcoded-key',
      content: {
        inputDiff: DIFF,
        inputFiles: ['src/config.ts'],
        inputMeta: { pr_title: 'Add stripe key', pr_description: 'Wires the payment key' },
        expectedOutput: [],
      },
    });
    expect(res.revision_created).toBe(true);
    expect(res.case).toMatchObject({ id: 'c-new', origin: 'manual', provenance: null, expected_output: [] });
  });

  it('refuses a stray-line diff with the issue and its line, nothing inserted', async () => {
    const { cases, service } = setup();
    const err = await refusal(service.createCase(WS, AGENT, draft({ input_diff: `junk\n${DIFF}` })));
    expect(err).toMatchObject({ code: 'eval_case_invalid', statusCode: 422 });
    expect((err.details as { issues: unknown[] }).issues).toContainEqual({
      field: 'input_diff',
      code: 'diff_stray_line',
      line: 1,
      key: null,
    });
    expect(cases.inserted).toHaveLength(0);
  });

  it('refuses a duplicate name before any insert', async () => {
    const { cases, service } = setup();
    cases.views.set('c1', view());
    const err = await refusal(service.createCase(WS, AGENT, draft()));
    expect(err.details).toEqual({ issues: [{ field: 'name', code: 'name_taken', line: null, key: null }] });
    expect(cases.inserted).toHaveLength(0);
  });

  it('a name taken by a concurrent save (insert answers null) → the same 422', async () => {
    const { cases, service } = setup();
    cases.insertAnswer = null;
    const err = await refusal(service.createCase(WS, AGENT, draft()));
    expect(err).toMatchObject({
      code: 'eval_case_invalid',
      statusCode: 422,
      details: { issues: [{ field: 'name', code: 'name_taken', line: null, key: null }] },
    });
  });

  it('unknown owner → NotFoundError, nothing inserted', async () => {
    const { cases, service } = setup();
    await expect(service.createCase(WS, { kind: 'agent', id: 'nope' }, draft())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(cases.inserted).toHaveLength(0);
  });
});

describe('EvalCaseService.updateCase', () => {
  it('rename only → no revision', async () => {
    const { cases, service } = setup();
    cases.views.set('c1', view());
    const res = await service.updateCase(WS, AGENT, 'c1', draft({ name: 'renamed' }));
    expect(cases.updates).toEqual([{ workspaceId: WS, caseId: 'c1', name: 'renamed', content: null }]);
    expect(res.revision_created).toBe(false);
  });

  it('end line changed → content passed and a revision created', async () => {
    const { cases, service } = setup();
    cases.views.set('c1', view());
    const res = await service.updateCase(
      WS,
      AGENT,
      'c1',
      draft({ expectation: { file: 'src/config.ts', start_line: 10, end_line: 11 } }),
    );
    expect(cases.updates[0]!.content).toMatchObject({
      expectation: { file: 'src/config.ts', start_line: 10, end_line: 11 },
    });
    expect(res.revision_created).toBe(true);
  });

  it('a name clash caught by the index → 422 eval_case_invalid with name_taken', async () => {
    const { cases, service } = setup();
    cases.views.set('c1', view());
    cases.updateAnswer = 'name_taken';
    const err = await refusal(service.updateCase(WS, AGENT, 'c1', draft({ name: 'other' })));
    expect(err).toMatchObject({
      code: 'eval_case_invalid',
      statusCode: 422,
      details: { issues: [{ field: 'name', code: 'name_taken', line: null, key: null }] },
    });
  });

  it('a concurrent revision → 409 eval_case_edit_conflict', async () => {
    const { cases, service } = setup();
    cases.views.set('c1', view());
    cases.updateAnswer = 'conflict';
    const err = await refusal(service.updateCase(WS, AGENT, 'c1', draft({ pr_title: 'new' })));
    expect(err).toMatchObject({ code: 'eval_case_edit_conflict', statusCode: 409 });
  });

  it('finding-made case with a changed diff → 422 eval_case_content_fixed, nothing written', async () => {
    const { cases, service } = setup();
    cases.views.set('c1', view({ provenance: PROVENANCE }));
    const err = await refusal(
      service.updateCase(WS, AGENT, 'c1', draft({ input_diff: `${DIFF}\n+  more: 1,` })),
    );
    expect(err).toMatchObject({ code: 'eval_case_content_fixed', statusCode: 422 });
    expect(cases.updates).toHaveLength(0);
  });

  it('unknown case → NotFoundError before any write', async () => {
    const { cases, service } = setup();
    await expect(service.updateCase(WS, AGENT, 'gone', draft())).rejects.toBeInstanceOf(NotFoundError);
    expect(cases.updates).toHaveLength(0);
  });
});

describe('EvalCaseService.getCase', () => {
  it('a check finished after the run result is the last run', async () => {
    const { cases, service } = setup();
    const v = view({ provenance: PROVENANCE });
    const runResult: EvalCaseLastRun = {
      source: 'run',
      status: 'failed',
      expected: 0,
      got: 1,
      error: null,
      duration_ms: 10,
      cost_usd: 0.01,
      finished_at: '2026-10-10T00:00:00.000Z',
    };
    const check: EvalCaseCheck = {
      id: 'chk1',
      case_revision_id: 'rev1',
      status: 'passed',
      started_at: '2026-10-11T00:00:00.000Z',
      finished_at: '2026-10-11T00:00:05.000Z',
      duration_ms: 5000,
      expected: 0,
      got: 0,
      error: null,
      cost_usd: null,
    };
    cases.views.set('c1', { ...v, runResult, check });
    const detail = await service.getCase(WS, AGENT, 'c1');
    expect(detail.last_run).toMatchObject({ source: 'check', status: 'passed' });
    expect(detail.origin).toBe('finding');
    // A4: a finding-made must_not_flag case shows `[]`.
    expect(detail.expected_output).toEqual([]);
  });
});

describe('EvalCaseService.startCheck', () => {
  it('a running check of the case → 409 eval_case_check_in_progress, no model call', async () => {
    const { cases, service, llmCalls } = setup();
    cases.views.set('c1', view());
    cases.checkAnswer = null;
    const err = await refusal(service.startCheck(WS, AGENT, 'c1', logger));
    expect(err).toMatchObject({ code: 'eval_case_check_in_progress', statusCode: 409 });
    expect(llmCalls()).toBe(0);
  });

  it('answers the check id at once, then closes the check as passed with got = 1', async () => {
    const { cases, service } = setup();
    cases.views.set('c1', view());
    const res = await service.startCheck(WS, AGENT, 'c1', logger);
    expect(res).toEqual({ check_id: 'chk1' });
    expect(cases.starts).toEqual([{ workspaceId: WS, caseId: 'c1', caseRevisionId: 'rev1', expected: 1 }]);
    const finished = await cases.finishedOnce;
    expect(finished).toMatchObject({ status: 'passed', got: 1, error: null });
    expect(cases.finished[0]!.id).toBe('chk1');
  });

  it('the provider failing (EC18) → errored with the reason and unknown cost', async () => {
    const { cases, service } = setup(async () => {
      throw new ConfigError('no OpenAI key');
    });
    cases.views.set('c1', view());
    await service.startCheck(WS, AGENT, 'c1', logger);
    const finished = await cases.finishedOnce;
    expect(finished).toMatchObject({ status: 'errored', error: 'no OpenAI key', costUsd: null, got: null });
  });

  it('a single-case run has no way to write a run or a run result', () => {
    const { cases } = setup();
    for (const name of ['createRun', 'insertCaseResult', 'closeRun', 'createSkillRun']) {
      expect(name in cases).toBe(false);
    }
  });

  it('unknown owner or case → NotFoundError and no runner call', async () => {
    const { cases, service, llmCalls } = setup();
    cases.views.set('c1', view());
    await expect(
      service.startCheck(WS, { kind: 'agent', id: 'nope' }, 'c1', logger),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.startCheck(WS, AGENT, 'gone', logger)).rejects.toBeInstanceOf(NotFoundError);
    expect(cases.starts).toHaveLength(0);
    expect(llmCalls()).toBe(0);
  });
});

describe('EvalCaseService.reapStaleChecks', () => {
  it('closes running checks with the restart reason', async () => {
    const { cases, service } = setup();
    const calls: [string, Date][] = [];
    cases.failRunningChecks = async (reason: string, at: Date) => {
      calls.push([reason, at]);
      return 2;
    };
    expect(await service.reapStaleChecks()).toBe(2);
    expect(calls).toEqual([['interrupted by a server restart', new Date('2026-10-13T00:00:00.000Z')]]);
  });
});

import { describe, expect, it } from 'vitest';
import type {
  AgentEvalCase,
  AgentEvalRunDetail,
  EvalRunRecord,
  LLMProvider,
  Provider,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { AppError, ConfigError, NotFoundError } from '../src/platform/errors.js';
import { EvalService, type EvalDeps } from '../src/modules/evals/service.js';
import type { NewSkillRun, SkillEvalAgentRow, SkillForRun } from '../src/modules/evals/editor-types.js';
import type {
  AgentConfigSource,
  CaseForRun,
  CaseResultInsert,
  FindingForCase,
  NewEvalCase,
  NewEvalRun,
  RunClose,
} from '../src/modules/evals/types.js';

const PATCH = '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "x",\n   redisUrl: y,';
const WS = 'ws1';

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

const logger = { info: () => {}, warn: () => {}, error: () => {} };

function found(over: Partial<FindingForCase['finding']> = {}, agentId: string | null = 'a1'): FindingForCase {
  return {
    finding: {
      id: 'f1',
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
      kind: 'finding',
      severity: 'WARNING',
      category: 'bug',
      title: 'Hardcoded key',
      acceptedAt: new Date('2026-10-01T00:00:00Z'),
      dismissedAt: null,
      ...over,
    },
    review: { id: 'rv1', agentId, runId: 'run1' },
    pull: { id: 'p1', number: 7, title: 'Add stripe', body: 'desc' },
    repo: { id: 'r1', fullName: 'o/n' },
    agentVersion: 2,
  };
}

class FakeRepo {
  finding: FindingForCase | undefined = found();
  agentOk = true;
  patch: string | null = PATCH;
  names: string[] = [];
  nullInserts = 0;
  insertCalls: NewEvalCase[] = [];
  nameReads = 0;
  caseList: CaseForRun[] = [];
  running = false;
  source: AgentConfigSource | undefined = {
    agent: { id: 'a1', name: 'Agent', version: 4, provider: 'openai', model: 'm', systemPrompt: 'sp', strategy: 'single-pass' },
    skills: [],
  };
  createdRuns: NewEvalRun[] = [];
  results: CaseResultInsert[] = [];
  closes: { id: string; values: RunClose }[] = [];
  running_: { id: string; startedAt: Date }[] = [];
  lastAt: Date | null = null;
  private closed!: () => void;
  closedPromise = new Promise<void>((r) => {
    this.closed = r;
  });

  async findingForCase() {
    return this.finding;
  }
  async agentExists() {
    return this.agentOk;
  }
  async prFilePatch() {
    return this.patch;
  }
  async agentCaseNames() {
    this.nameReads += 1;
    return [...this.names];
  }
  async insertCase(values: NewEvalCase) {
    this.insertCalls.push(values);
    if (this.nullInserts > 0) {
      this.nullInserts -= 1;
      return null;
    }
    const c: AgentEvalCase = {
      id: `c${this.insertCalls.length}`,
      agent_id: values.agentId,
      name: values.name,
      revision_id: 'rev1',
      revision: 1,
      expectation_type: values.expectationType,
      expectation: values.expectation,
      input_file: values.inputFile,
      input_meta: values.inputMeta,
      provenance: values.provenance,
      created_at: '2026-10-01T00:00:00Z',
    };
    this.names.push(values.name);
    return { case: c, created: true };
  }
  async listCases() {
    return [];
  }
  async deleteCase() {
    return true;
  }
  async casesForRun() {
    return this.caseList;
  }
  async agentConfigSource() {
    return this.source;
  }
  async createRun(values: NewEvalRun) {
    if (this.running) return null;
    this.createdRuns.push(values);
    return 'run-1';
  }
  async insertCaseResult(values: CaseResultInsert) {
    this.results.push(values);
  }
  async runResults(): Promise<EvalRunRecord[]> {
    return this.results.map((r) => ({
      case_id: r.caseId,
      eval_run_id: r.evalRunId,
      case_revision_id: r.caseRevisionId,
      case_name: r.caseName,
      status: r.status,
      error: r.error,
      expectation_type: r.expectationType,
      expectation: r.expectation,
      findings_returned: r.findingsReturned,
      findings_grounded: r.findingsGrounded,
      findings_matching: r.findingsMatching,
      cost_usd: r.costUsd,
    })) as unknown as EvalRunRecord[];
  }
  async closeRun(id: string, values: RunClose) {
    this.closes.push({ id, values });
    this.closed();
  }
  async listRuns() {
    return [];
  }
  async getRun(): Promise<AgentEvalRunDetail | undefined> {
    return undefined;
  }
  async runningRuns() {
    return this.running_;
  }
  async lastResultAt() {
    return this.lastAt;
  }
}

class FakeSkills {
  skill: SkillForRun | undefined = {
    id: 's1',
    name: 'Secrets',
    description: 'finds secrets',
    body: 'Look for hardcoded keys',
    version: 3,
  };
  remembered: SkillEvalAgentRow | undefined = { agentId: 'a1', agentName: 'Agent' };
  agents: Record<string, string> = { a1: 'Agent', a2: 'Other' };
  caseList: CaseForRun[] = [];
  running = false;
  createdSkillRuns: NewSkillRun[] = [];
  setCalls: { skillId: string; agent: { id: string; name: string } }[] = [];

  async skillForRun() {
    return this.skill;
  }
  async evalAgent() {
    return this.remembered;
  }
  async setEvalAgent(_ws: string, skillId: string, agent: { id: string; name: string }) {
    this.setCalls.push({ skillId, agent });
    this.remembered = { agentId: agent.id, agentName: agent.name };
  }
  async agentName(_ws: string, agentId: string) {
    return this.agents[agentId];
  }
  async casesForSkill() {
    return this.caseList;
  }
  async createSkillRun(values: NewSkillRun) {
    if (this.running) return null;
    this.createdSkillRuns.push(values);
    return 'skill-run-1';
  }
  async listSkillRuns() {
    return [];
  }
}

class MarkerLLM extends MockLLMProvider {
  constructor(private failOn: string) {
    super('openai', { structured: REVIEW });
  }
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (JSON.stringify(req).includes(this.failOn)) throw new Error('model exploded');
    return super.completeStructured(req);
  }
}

function make(
  repo: FakeRepo,
  llm: (p: Provider) => Promise<LLMProvider>,
  skills: FakeSkills = new FakeSkills(),
): EvalService {
  const deps: EvalDeps = {
    repo,
    skills,
    llm,
    parseDiff: parseUnifiedDiff,
    tokenizer: { count: (s) => s.length },
    promptLogMode: 'off',
    now: () => new Date('2026-10-12T10:00:00Z'),
  };
  return new EvalService(deps);
}

function runCase(n: number, title = `PR-${n}`): CaseForRun {
  return {
    id: `c${n}`,
    revisionId: `rev${n}`,
    revision: 1,
    name: `case-${n}`,
    expectationType: 'must_find',
    expectation: { file: 'src/config.ts', start_line: 11, end_line: 11 },
    inputDiff: `diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n${PATCH}`,
    inputMeta: { pr_title: title, pr_description: '' },
  };
}

const ok = (p: LLMProvider) => async () => p;

describe('EvalService.createCaseFromFinding', () => {
  it('creates a must_find case with a frozen diff and provenance', async () => {
    const repo = new FakeRepo();
    const res = await make(repo, ok(new MockLLMProvider())).createCaseFromFinding(WS, 'f1');
    expect(res.created).toBe(true);
    expect(res.case.name).toBe('hardcoded-key');
    const v = repo.insertCalls[0]!;
    expect(v.expectationType).toBe('must_find');
    expect(v.inputDiff).toContain('diff --git a/src/config.ts b/src/config.ts');
    expect(v.provenance).toMatchObject({ decision: 'accepted', agent_version: 2, pr_number: 7 });
  });

  it('suffixes a taken name and retries when a concurrent insert wins', async () => {
    const repo = new FakeRepo();
    repo.names = ['hardcoded-key'];
    const res = await make(repo, ok(new MockLLMProvider())).createCaseFromFinding(WS, 'f1');
    expect(res.case.name).toBe('hardcoded-key-2');

    const repo2 = new FakeRepo();
    repo2.nullInserts = 1;
    const res2 = await make(repo2, ok(new MockLLMProvider())).createCaseFromFinding(WS, 'f1');
    expect(res2.created).toBe(true);
    expect(repo2.nameReads).toBe(2);
  });

  it('throws after five attempts and creates nothing', async () => {
    const repo = new FakeRepo();
    repo.nullInserts = 99;
    await expect(make(repo, ok(new MockLLMProvider())).createCaseFromFinding(WS, 'f1')).rejects.toThrow(
      'eval case name still taken after 5 attempts',
    );
    expect(repo.insertCalls).toHaveLength(5);
    expect(repo.names).toHaveLength(0);
  });

  it('refuses an undecided finding with 422 and writes nothing; unknown finding is 404', async () => {
    const repo = new FakeRepo();
    repo.finding = found({ acceptedAt: null });
    const err = await make(repo, ok(new MockLLMProvider()))
      .createCaseFromFinding(WS, 'f1')
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'eval_case_undecided', statusCode: 422 });
    expect(repo.insertCalls).toHaveLength(0);

    repo.finding = undefined;
    await expect(make(repo, ok(new MockLLMProvider())).createCaseFromFinding(WS, 'f1')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('EvalService.startRun', () => {
  it('refuses with no cases (422) and with a running run (409)', async () => {
    const repo = new FakeRepo();
    const svc = make(repo, ok(new MockLLMProvider()));
    await expect(svc.startRun(WS, 'a1', logger)).rejects.toMatchObject({
      code: 'no_eval_cases',
      statusCode: 422,
    });
    repo.caseList = [runCase(1)];
    repo.running = true;
    await expect(svc.startRun(WS, 'a1', logger)).rejects.toMatchObject({
      code: 'eval_run_in_progress',
      statusCode: 409,
    });
  });

  it('scores cases, errors one, records revisions, and sends only frozen inputs', async () => {
    const repo = new FakeRepo();
    repo.caseList = [runCase(1), runCase(2, 'BOOM-TITLE'), runCase(3), runCase(4)];
    const llm = new MarkerLLM('BOOM-TITLE');
    let resolved = 0;
    const svc = make(repo, async () => {
      resolved += 1;
      return llm;
    });
    const { run_id } = await svc.startRun(WS, 'a1', logger);
    expect(run_id).toBe('run-1');
    await repo.closedPromise;

    expect(resolved).toBe(4);
    expect(repo.createdRuns[0]!.cases).toEqual([
      { case_id: 'c1', revision_id: 'rev1', revision: 1 },
      { case_id: 'c2', revision_id: 'rev2', revision: 1 },
      { case_id: 'c3', revision_id: 'rev3', revision: 1 },
      { case_id: 'c4', revision_id: 'rev4', revision: 1 },
    ]);
    expect(repo.results).toHaveLength(4);
    for (const r of repo.results) expect(r.caseRevisionId).toBe(`rev${r.caseId.slice(1)}`);
    const errored = repo.results.filter((r) => r.status === 'errored');
    expect(errored).toHaveLength(1);
    expect(errored[0]).toMatchObject({ caseId: 'c2', error: 'model exploded', costUsd: null });
    expect(repo.results.filter((r) => r.status === 'passed')).toHaveLength(3);
    expect(repo.closes[0]!.values).toMatchObject({ status: 'completed', casesScored: 3, casesPassed: 3 });

    const structured = llm.calls.filter((c) => c.method === 'completeStructured');
    // the failing case throws before the mock records it
    expect(structured).toHaveLength(3);
    const text = JSON.stringify(structured[0]!.req);
    expect(text).not.toContain('Callers');
  });

  it('fails the run and nulls the cost when the provider cannot be resolved', async () => {
    const repo = new FakeRepo();
    repo.caseList = [runCase(1), runCase(2)];
    const svc = make(repo, async () => {
      throw new ConfigError('no key');
    });
    await svc.startRun(WS, 'a1', logger);
    await repo.closedPromise;
    expect(repo.results.every((r) => r.status === 'errored' && r.costUsd === null)).toBe(true);
    expect(repo.closes[0]!.values).toMatchObject({ status: 'failed', costUsd: null, error: 'no case was scored' });
  });
});

describe('EvalService.reapStaleRuns', () => {
  it('completes a run with a scored result and fails one without', async () => {
    const repo = new FakeRepo();
    repo.running_ = [{ id: 'r-a', startedAt: new Date('2026-10-12T09:00:00Z') }];
    repo.results = [
      {
        workspaceId: WS,
        evalRunId: 'r-a',
        caseId: 'c1',
        caseRevisionId: 'rev1',
        caseName: 'n',
        expectationType: 'must_find',
        expectation: { file: 'a', start_line: 1, end_line: 1 },
        status: 'passed',
        error: null,
        findingsReturned: 1,
        findingsGrounded: 1,
        findingsMatching: 1,
        recall: 1,
        precision: 1,
        citationAccuracy: 1,
        durationMs: 1,
        costUsd: null,
        actualOutput: null,
      },
    ];
    repo.lastAt = new Date('2026-10-12T09:05:00Z');
    const svc = make(repo, ok(new MockLLMProvider()));
    expect(await svc.reapStaleRuns()).toBe(1);
    expect(repo.closes[0]!.values).toMatchObject({ status: 'completed', durationMs: 300_000 });

    const repo2 = new FakeRepo();
    repo2.running_ = [{ id: 'r-b', startedAt: new Date('2026-10-12T09:00:00Z') }];
    expect(await make(repo2, ok(new MockLLMProvider())).reapStaleRuns()).toBe(1);
    expect(repo2.closes[0]!.values).toMatchObject({ status: 'failed', durationMs: 0 });
  });
});

describe('EvalService.startSkillRun', () => {
  it('refuses with no remembered agent, a deleted agent, no cases, or a running run', async () => {
    const repo = new FakeRepo();
    const skills = new FakeSkills();
    const svc = make(repo, ok(new MockLLMProvider()), skills);

    skills.remembered = undefined;
    const required = await svc.startSkillRun(WS, 's1', logger).catch((e) => e);
    expect(required).toBeInstanceOf(AppError);
    expect(required).toMatchObject({ code: 'eval_agent_required', statusCode: 422 });

    skills.remembered = { agentId: null, agentName: 'Gone Agent' };
    const missing = await svc.startSkillRun(WS, 's1', logger).catch((e) => e);
    expect(missing).toBeInstanceOf(AppError);
    expect(missing).toMatchObject({
      code: 'eval_agent_missing',
      statusCode: 422,
      details: { agent_name: 'Gone Agent' },
    });

    skills.remembered = { agentId: 'a1', agentName: 'Agent' };
    await expect(svc.startSkillRun(WS, 's1', logger)).rejects.toMatchObject({
      code: 'no_eval_cases',
      statusCode: 422,
    });

    skills.caseList = [runCase(1)];
    skills.running = true;
    await expect(svc.startSkillRun(WS, 's1', logger)).rejects.toMatchObject({
      code: 'eval_run_in_progress',
      statusCode: 409,
    });
    expect(skills.createdSkillRuns).toHaveLength(0);
    expect(repo.createdRuns).toHaveLength(0);

    skills.skill = undefined;
    await expect(svc.startSkillRun(WS, 's1', logger)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('records skill version, via agent and a config with the skill on, then runs the cases', async () => {
    const repo = new FakeRepo();
    const skills = new FakeSkills();
    skills.caseList = [runCase(1), runCase(2)];
    const svc = make(repo, ok(new MockLLMProvider('openai', { structured: REVIEW })), skills);

    const { run_id } = await svc.startSkillRun(WS, 's1', logger);
    expect(run_id).toBe('skill-run-1');
    const created = skills.createdSkillRuns[0]!;
    expect(created).toMatchObject({
      workspaceId: WS,
      skillId: 's1',
      skillVersion: 3,
      viaAgentId: 'a1',
      agentName: 'Agent',
      agentVersion: 4,
      cases: [
        { case_id: 'c1', revision_id: 'rev1', revision: 1 },
        { case_id: 'c2', revision_id: 'rev2', revision: 1 },
      ],
    });
    expect(created.config.agent_version).toBe(4);
    expect(created.config.skills).toEqual([
      expect.objectContaining({ id: 's1', version: 3, link_enabled: true, skill_enabled: true }),
    ]);
    // The agent's own run path is untouched.
    expect(repo.createdRuns).toHaveLength(0);

    await repo.closedPromise;
    expect(repo.results.map((r) => r.evalRunId)).toEqual(['skill-run-1', 'skill-run-1']);
    expect(repo.closes[0]).toMatchObject({ id: 'skill-run-1', values: { status: 'completed' } });
  });
});

describe('EvalService skill eval agent', () => {
  it('reads the remembered agent, names a deleted one, and 404s an unknown skill', async () => {
    const skills = new FakeSkills();
    const svc = make(new FakeRepo(), ok(new MockLLMProvider()), skills);
    expect(await svc.getSkillEvalAgent(WS, 's1')).toEqual({
      agent: { id: 'a1', name: 'Agent' },
      missing_agent_name: null,
    });
    skills.remembered = { agentId: null, agentName: 'Gone Agent' };
    expect(await svc.getSkillEvalAgent(WS, 's1')).toEqual({ agent: null, missing_agent_name: 'Gone Agent' });
    skills.remembered = undefined;
    expect(await svc.getSkillEvalAgent(WS, 's1')).toEqual({ agent: null, missing_agent_name: null });
    skills.skill = undefined;
    await expect(svc.getSkillEvalAgent(WS, 's1')).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.listSkillRuns(WS, 's1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('remembers a chosen agent and refuses an unknown one with NotFoundError', async () => {
    const skills = new FakeSkills();
    const svc = make(new FakeRepo(), ok(new MockLLMProvider()), skills);
    expect(await svc.setSkillEvalAgent(WS, 's1', 'a2')).toEqual({
      agent: { id: 'a2', name: 'Other' },
      missing_agent_name: null,
    });
    expect(skills.setCalls).toEqual([{ skillId: 's1', agent: { id: 'a2', name: 'Other' } }]);

    await expect(svc.setSkillEvalAgent(WS, 's1', 'nope')).rejects.toBeInstanceOf(NotFoundError);
    expect(skills.setCalls).toHaveLength(1);
  });
});

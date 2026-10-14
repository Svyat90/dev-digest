import { describe, expect, it } from 'vitest';
import type { EvalCaseOwner } from '@devdigest/shared';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { AppError, ConfigError, NotFoundError } from '../src/platform/errors.js';
import {
  resolveRunConfig,
  runCaseReview,
  type CaseRunnerDeps,
  type RunConfigPorts,
} from '../src/modules/evals/run-executor.js';
import type { SkillEvalAgentRow, SkillForRun } from '../src/modules/evals/editor-types.js';
import { buildRunConfig } from '../src/modules/evals/helpers.js';
import type { AgentConfigSource, CaseForRun } from '../src/modules/evals/types.js';

const WS = 'ws1';
const PATCH = '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "x",\n   redisUrl: y,';

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
const ctx = { correlationId: 'run-1', agentName: 'Agent', logger };

function source(skills: AgentConfigSource['skills'] = []): AgentConfigSource {
  return {
    agent: {
      id: 'a1',
      name: 'Agent',
      version: 4,
      provider: 'openai',
      model: 'm',
      systemPrompt: 'sp',
      strategy: 'single-pass',
    },
    skills,
  };
}

const CASE = {
  id: 'c1',
  revisionId: 'rev1',
  revision: 1,
  name: 'secret-case-name',
  expectationType: 'must_find',
  expectation: { file: 'src/config.ts', start_line: 11, end_line: 11 },
  inputDiff: `diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n${PATCH}`,
  inputMeta: { pr_title: 'Add stripe key', pr_description: 'Wires the payment key' },
  // Not part of `CaseForRun`: proves an extra field never reaches the engine (AC25).
  expectedOutput: [{ title: 'SECRET-EXPECTED-TITLE' }],
} as CaseForRun;

function deps(llm: CaseRunnerDeps['llm']): CaseRunnerDeps {
  return {
    llm,
    parseDiff: parseUnifiedDiff,
    tokenizer: { count: (s) => s.length },
    promptLogMode: 'off',
  };
}

describe('runCaseReview', () => {
  it('scores a matching finding and sends only the diff, title and description', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW });
    const outcome = await runCaseReview(deps(async () => llm), buildRunConfig(source()), CASE, ctx);

    expect(outcome).toMatchObject({ status: 'passed', error: null, findingsMatching: 1 });
    const req = JSON.stringify(llm.calls.filter((c) => c.method === 'completeStructured'));
    expect(req).toContain('stripeKey');
    expect(req).toContain('Add stripe key');
    expect(req).toContain('Wires the payment key');
    expect(req).not.toContain('secret-case-name');
    expect(req).not.toContain('SECRET-EXPECTED-TITLE');
  });

  it('returns errored with the reason and unknown cost when the provider cannot be resolved', async () => {
    const outcome = await runCaseReview(
      deps(async () => {
        throw new ConfigError('no OpenAI key');
      }),
      buildRunConfig(source()),
      CASE,
      ctx,
    );
    expect(outcome).toMatchObject({ status: 'errored', error: 'no OpenAI key', costUsd: null });
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });
});

class FakePorts implements RunConfigPorts {
  source: AgentConfigSource | undefined = source();
  skill: SkillForRun | undefined = {
    id: 's1',
    name: 'Secrets',
    description: 'd',
    body: 'Never hardcode keys',
    version: 3,
  };
  agent: SkillEvalAgentRow | undefined = { agentId: 'a1', agentName: 'Agent' };
  calls: string[] = [];

  async agentConfigSource(workspaceId: string, agentId: string) {
    this.calls.push(`agent:${workspaceId}:${agentId}`);
    return this.source;
  }
  async skillForRun(workspaceId: string, skillId: string) {
    this.calls.push(`skill:${workspaceId}:${skillId}`);
    return this.skill;
  }
  async evalAgent(workspaceId: string, skillId: string) {
    this.calls.push(`evalAgent:${workspaceId}:${skillId}`);
    return this.agent;
  }
}

const SKILL: EvalCaseOwner = { kind: 'skill', id: 's1' };

describe('resolveRunConfig', () => {
  it('agent owner: the agent configuration, skills unchanged', async () => {
    const ports = new FakePorts();
    ports.source = source([
      { id: 's1', name: 'Secrets', description: 'd', body: 'b', version: 1, order: 0, linkEnabled: false, skillEnabled: true },
    ]);
    const resolved = await resolveRunConfig(ports, WS, { kind: 'agent', id: 'a1' });
    expect(resolved).toMatchObject({ agentId: 'a1', agentName: 'Agent', skill: null });
    expect(resolved.config.skills[0]).toMatchObject({ id: 's1', link_enabled: false, body: null });
  });

  it('skill owner: a linked but disabled skill is on at its order, through the remembered agent', async () => {
    const ports = new FakePorts();
    ports.source = source([
      { id: 's0', name: 'Other', description: 'd', body: 'o', version: 1, order: 0, linkEnabled: true, skillEnabled: true },
      { id: 's1', name: 'Secrets', description: 'd', body: 'old', version: 2, order: 1, linkEnabled: false, skillEnabled: true },
    ]);
    const resolved = await resolveRunConfig(ports, WS, SKILL);
    expect(resolved).toMatchObject({ agentId: 'a1', agentName: 'Agent', skill: { id: 's1', version: 3 } });
    expect(resolved.config.skills.map((s) => [s.id, s.order, s.body])).toEqual([
      ['s0', 0, 'o'],
      ['s1', 1, 'Never hardcode keys'],
    ]);
    expect(ports.calls).toEqual(['skill:ws1:s1', 'evalAgent:ws1:s1', 'agent:ws1:a1']);
  });

  it('skill owner with no remembered agent → 422 eval_agent_required', async () => {
    const ports = new FakePorts();
    ports.agent = undefined;
    await expect(resolveRunConfig(ports, WS, SKILL)).rejects.toMatchObject({
      code: 'eval_agent_required',
      statusCode: 422,
    });
  });

  it('remembered agent deleted → 422 eval_agent_missing with its name', async () => {
    const ports = new FakePorts();
    ports.agent = { agentId: null, agentName: 'Old Agent' };
    const err = await resolveRunConfig(ports, WS, SKILL).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({
      code: 'eval_agent_missing',
      statusCode: 422,
      details: { agent_name: 'Old Agent' },
    });

    const gone = new FakePorts();
    gone.source = undefined;
    await expect(resolveRunConfig(gone, WS, SKILL)).rejects.toMatchObject({
      code: 'eval_agent_missing',
      details: { agent_name: 'Agent' },
    });
  });

  it('unknown owner → NotFoundError', async () => {
    const ports = new FakePorts();
    ports.source = undefined;
    await expect(resolveRunConfig(ports, WS, { kind: 'agent', id: 'a1' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const noSkill = new FakePorts();
    noSkill.skill = undefined;
    await expect(resolveRunConfig(noSkill, WS, SKILL)).rejects.toBeInstanceOf(NotFoundError);
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { AgentEvalRunSummary, EvalRunConfig } from '@devdigest/shared';
import { EvalDashboardService } from '../src/modules/eval-dashboard/service.js';
import type { EvalDashboardDeps } from '../src/modules/eval-dashboard/service.js';
import type {
  CurrentAgentConfig,
  DashboardAgentRow,
  StoredRun,
} from '../src/modules/eval-dashboard/types.js';
import { AppError, NotFoundError } from '../src/platform/errors.js';

const NOW = new Date('2026-10-12T12:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const summary = (id: string, over: Partial<AgentEvalRunSummary> = {}): AgentEvalRunSummary => ({
  id,
  agent_id: 'A',
  status: 'completed',
  started_at: daysAgo(1),
  finished_at: daysAgo(1),
  duration_ms: 1000,
  agent_version: 2,
  cases_total: 2,
  cases_done: 2,
  cases_scored: 2,
  cases_passed: 2,
  recall: 1,
  precision: 1,
  citation_accuracy: 1,
  cost_usd: null,
  error: null,
  ...over,
});

const config = (over: Partial<EvalRunConfig> = {}): EvalRunConfig => ({
  agent_version: 1,
  provider: 'openai',
  model: 'm',
  system_prompt: 'p',
  strategy: 'single-pass',
  skills: [
    {
      id: 's1',
      name: 'S1',
      description: '',
      version: 1,
      order: 0,
      link_enabled: true,
      skill_enabled: true,
      body: 'old body',
    },
  ],
  ...over,
});

const stored = (id: string, over: Partial<StoredRun> = {}): StoredRun => ({
  ...summary(id),
  config: config(),
  cases: [{ case_id: 'c1', revision_id: `${id}-r`, revision: 1 }],
  ...over,
});

const agentRows: DashboardAgentRow[] = [
  { id: 'A', name: 'Alpha', provider: 'openai', model: 'm', enabled: true },
  { id: 'B', name: 'Beta', provider: 'openai', model: 'm', enabled: true },
  { id: 'C', name: 'Gamma', provider: 'openai', model: 'm', enabled: false },
];

const current: CurrentAgentConfig = {
  id: 'A',
  name: 'Alpha',
  version: 3,
  provider: 'openai',
  model: 'm',
  systemPrompt: 'p',
  strategy: 'single-pass',
  outputSchema: null,
  ciFailOn: 'high' as CurrentAgentConfig['ciFailOn'],
  repoIntel: false,
  links: [{ skillId: 's1', enabled: true }],
};

function makeDeps(over: {
  runs?: Record<string, StoredRun>;
  completed?: StoredRun[];
  points?: unknown[];
  skillBody?: string;
  currentSkillBody?: string;
  startRun?: (ws: string, id: string) => Promise<{ run_id: string }>;
  agentConfig?: CurrentAgentConfig;
} = {}) {
  const applyPromotion = vi.fn(async () => ({
    agentVersion: 4,
    restored: [{ skillId: 's1', version: 5 }],
  }));
  const startRun = vi.fn(over.startRun ?? (async (_w: string, id: string) => ({ run_id: `run-${id}` })));
  const deps = {
    dashboard: {
      listAgents: async () => agentRows,
      caseCounts: async () => new Map([['A', 2], ['B', 2]]),
      runningRuns: async () => new Map<string, AgentEvalRunSummary>(),
      latestCompletedPerAgent: async () => new Map([['A', summary('a-latest')]]),
      recallSamplesSince: async () => [
        { agentId: 'A', startedAt: new Date(daysAgo(5)), recall: 0.5 },
        { agentId: 'A', startedAt: new Date(daysAgo(2)), recall: null },
        { agentId: 'A', startedAt: new Date(daysAgo(1)), recall: 1 },
      ],
      recentRuns: async () => [{ ...summary('a-latest'), agent_name: 'Alpha' }],
      agentRow: async (_w: string, id: string) => agentRows.find((a) => a.id === id),
      caseCount: async () => 2,
      lastCompletedRuns: async () => over.completed ?? [],
      runningRun: async () => undefined,
      runsSince: async () => [],
      completedPointsSince: async (_w: string, _a: string, since: Date | null) =>
        (over.points ?? []).filter(
          (p) => !since || Date.parse((p as { started_at: string }).started_at) >= since.getTime(),
        ),
    },
    promotion: {
      storedRun: async (_w: string, agentId: string, runId: string) => {
        const r = over.runs?.[runId];
        return r && r.agent_id === agentId ? r : undefined;
      },
      skillVersionBodies: async () => new Map([['s1', new Map([[1, over.skillBody ?? 'old body']])]]),
      currentAgentConfig: async () => over.agentConfig ?? current,
      skillsByIds: async () => [{ id: 's1', name: 'S1', body: over.currentSkillBody ?? 'new body', version: 5 }],
      otherAgentsLinking: async () => [{ id: 'B', name: 'Beta' }],
      applyPromotion,
    },
    runs: { startRun },
    now: () => NOW,
  } as unknown as EvalDashboardDeps;
  return { service: new EvalDashboardService(deps), applyPromotion, startRun };
}

describe('EvalDashboardService.workspace', () => {
  it('lists every agent, with latest only where a completed run exists (EC2)', async () => {
    const { service } = makeDeps();
    const out = await service.workspace('ws');
    expect(out.agents.map((a) => a.id)).toEqual(['A', 'B', 'C']);
    expect(out.agents[0]!.latest?.id).toBe('a-latest');
    expect(out.agents[0]!.recall_trend).toEqual([0.5, 1]);
    expect(out.agents[1]).toMatchObject({ latest: null, cases_total: 2 });
    expect(out.agents[2]).toMatchObject({ latest: null, cases_total: 0, enabled: false });
  });
});

describe('EvalDashboardService.agentDashboard', () => {
  it('applies the range to the trend only; latest, previous and alert ignore it', async () => {
    const newer = stored('n', { started_at: daysAgo(3), recall: 0.5 });
    const older = stored('o', { started_at: daysAgo(20), recall: 1 });
    const points = [
      { run_id: 'n', started_at: daysAgo(3), agent_version: 2, recall: 0.5, precision: 1, citation_accuracy: 1, cost_usd: null },
      { run_id: 'o', started_at: daysAgo(20), agent_version: 1, recall: 1, precision: 1, citation_accuracy: 1, cost_usd: null },
    ];
    const { service } = makeDeps({ completed: [newer, older], points });
    const out = await service.agentDashboard('ws', 'A', '7d');
    expect(out.trend).toHaveLength(1);
    expect(out.latest?.id).toBe('n');
    expect(out.previous?.id).toBe('o');
    expect(out.alert).toMatchObject({ metric: 'recall', drop_points: 50 });
    expect(out.trend_truncated).toBe(false);
  });

  it('404s for an unknown agent', async () => {
    const { service } = makeDeps();
    await expect(service.agentDashboard('ws', 'nope', '30d')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('EvalDashboardService.runAll', () => {
  it('starts eligible agents and reports skips; one failure never aborts the rest', async () => {
    const { service, startRun } = makeDeps({
      startRun: async (_w, id) => {
        if (id === 'B') throw new AppError('eval_run_in_progress', 'busy', 409);
        return { run_id: `run-${id}` };
      },
    });
    const out = await service.runAll('ws', logger);
    expect(out.started).toEqual([{ agent_id: 'A', run_id: 'run-A' }]);
    expect(out.skipped).toEqual([
      { agent_id: 'B', agent_name: 'Beta', reason: 'eval_run_in_progress' },
      { agent_id: 'C', agent_name: 'Gamma', reason: 'no_eval_cases' },
    ]);
    expect(startRun).toHaveBeenCalledTimes(2);
  });
});

describe('EvalDashboardService.compare', () => {
  it('404s for a run of another agent and 422s for a running run', async () => {
    const other = stored('x', { agent_id: 'Z' });
    const running = stored('r', { status: 'running' });
    const ok = stored('ok');
    const { service } = makeDeps({ runs: { x: other, r: running, ok } });
    await expect(service.compare('ws', 'A', 'x', 'ok')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.compare('ws', 'A', 'r', 'ok')).rejects.toMatchObject({
      code: 'eval_run_not_completed',
      statusCode: 422,
    });
  });

  it('puts the older run first whatever the argument order (EC13)', async () => {
    const old = stored('old', { started_at: daysAgo(5) });
    const young = stored('young', { started_at: daysAgo(1) });
    const { service } = makeDeps({ runs: { old, young } });
    const out = await service.compare('ws', 'A', 'young', 'old');
    expect(out.earlier.id).toBe('old');
    expect(out.later.id).toBe('young');
    expect(out.case_sets).toEqual({ added: 1, removed: 1 });
  });
});

describe('EvalDashboardService.promote', () => {
  it('409s and writes nothing when the run equals the current configuration (EC15)', async () => {
    const run = stored('r', { config: config() });
    const { service, applyPromotion } = makeDeps({ runs: { r: run }, currentSkillBody: 'old body' });
    await expect(service.promote('ws', 'A', 'r')).rejects.toMatchObject({
      code: 'eval_promote_noop',
      statusCode: 409,
    });
    expect(applyPromotion).not.toHaveBeenCalled();
  });

  it('applies one write with links in recorded order and the restore note', async () => {
    const run = stored('r', { config: config({ model: 'other' }) });
    const { service, applyPromotion } = makeDeps({ runs: { r: run } });
    const out = await service.promote('ws', 'A', 'r');
    expect(applyPromotion).toHaveBeenCalledTimes(1);
    const [, write] = applyPromotion.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(write.links).toEqual([{ skillId: 's1', enabled: true }]);
    expect(write.model).toBe('other');
    expect(write.restore).toEqual([
      { skillId: 's1', body: 'old body', note: 'Restored from v1 by Promote' },
    ]);
    expect(out).toEqual({
      agent_id: 'A',
      agent_version: 4,
      run_agent_version: 1,
      restored_skills: [{ skill_id: 's1', version: 5 }],
    });
  });
});

import type {
  EvalComparedRun,
  EvalDashboard,
  EvalDashboardRange,
  EvalPromotePreview,
  EvalRunComparison,
  EvalWorkspaceAgentRow,
  EvalWorkspaceDashboard,
  PromoteEvalRunResponse,
  RunAllEvalsResponse,
  RunAllEvalsSkipReason,
} from '@devdigest/shared';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import {
  RECALL_SPARKLINE_DAYS,
  RECENT_RUNS_LIMIT,
  TREND_POINT_CAP,
  buildRegressionAlert,
  capTrend,
  caseSetDiff,
  rangeStart,
} from '../../domain/evals/dashboard.js';
import { configChanges, orderPair, skillChanges } from '../../domain/evals/compare.js';
import { planPromotion, restoreNote } from '../../domain/evals/promote.js';
import type { PromotionPlan } from '../../domain/evals/promote.js';
import type { EvalDashboardRepository } from './repository/dashboard.repo.js';
import type { EvalPromotionRepository } from './repository/promotion.repo.js';
import type {
  CurrentAgentConfig,
  DashboardLogger,
  EvalRunStarter,
  StoredRun,
} from './types.js';

export interface EvalDashboardDeps {
  dashboard: Pick<
    EvalDashboardRepository,
    | 'listAgents'
    | 'caseCounts'
    | 'runningRuns'
    | 'latestCompletedPerAgent'
    | 'recallSamplesSince'
    | 'recentRuns'
    | 'agentRow'
    | 'caseCount'
    | 'lastCompletedRuns'
    | 'runningRun'
    | 'runsSince'
    | 'completedPointsSince'
  >;
  promotion: Pick<
    EvalPromotionRepository,
    | 'storedRun'
    | 'skillVersionBodies'
    | 'currentAgentConfig'
    | 'skillsByIds'
    | 'otherAgentsLinking'
    | 'applyPromotion'
  >;
  runs: EvalRunStarter;
  now?: () => Date;
}

const DAY_MS = 86_400_000;
const SKIP_REASONS: readonly RunAllEvalsSkipReason[] = ['no_eval_cases', 'eval_run_in_progress'];

const toCompared = ({ cases: _cases, ...run }: StoredRun): EvalComparedRun => run;

export class EvalDashboardService {
  constructor(private readonly deps: EvalDashboardDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  async workspace(workspaceId: string): Promise<EvalWorkspaceDashboard> {
    const { dashboard } = this.deps;
    const since = new Date(this.now().getTime() - RECALL_SPARKLINE_DAYS * DAY_MS);
    const [agents, caseCounts, running, latest, samples, recent] = await Promise.all([
      dashboard.listAgents(workspaceId),
      dashboard.caseCounts(workspaceId),
      dashboard.runningRuns(workspaceId),
      dashboard.latestCompletedPerAgent(workspaceId),
      dashboard.recallSamplesSince(workspaceId, since),
      dashboard.recentRuns(workspaceId, RECENT_RUNS_LIMIT),
    ]);

    const trendByAgent = new Map<string, number[]>();
    for (const s of samples) {
      if (s.recall === null) continue;
      const list = trendByAgent.get(s.agentId) ?? [];
      list.push(s.recall);
      trendByAgent.set(s.agentId, list);
    }

    const rows: EvalWorkspaceAgentRow[] = agents.map((a) => ({
      id: a.id,
      name: a.name,
      provider: a.provider,
      model: a.model,
      enabled: a.enabled,
      cases_total: caseCounts.get(a.id) ?? 0,
      running: running.has(a.id),
      latest: latest.get(a.id) ?? null,
      recall_trend: trendByAgent.get(a.id) ?? [],
    }));
    return { agents: rows, recent_runs: recent };
  }

  async agentDashboard(
    workspaceId: string,
    agentId: string,
    range: EvalDashboardRange,
  ): Promise<EvalDashboard> {
    const { dashboard } = this.deps;
    const agent = await dashboard.agentRow(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const since = rangeStart(range, this.now());
    const [casesTotal, lastTwo, running, runs, points] = await Promise.all([
      dashboard.caseCount(workspaceId, agentId),
      dashboard.lastCompletedRuns(workspaceId, agentId, 2),
      dashboard.runningRun(workspaceId, agentId),
      dashboard.runsSince(workspaceId, agentId, since),
      dashboard.completedPointsSince(workspaceId, agentId, since, TREND_POINT_CAP + 1),
    ]);

    const [latest, previous] = lastTwo;
    const trend = capTrend(points, TREND_POINT_CAP);
    return {
      agent: { id: agent.id, name: agent.name, provider: agent.provider, model: agent.model },
      range,
      cases_total: casesTotal,
      latest: latest ? toCompared(latest) : null,
      previous: previous ? toCompared(previous) : null,
      running_run: running ?? null,
      alert: buildRegressionAlert(latest ?? null, previous ?? null),
      trend: trend.points,
      trend_truncated: trend.truncated,
      runs,
    };
  }

  async runAll(workspaceId: string, logger: DashboardLogger): Promise<RunAllEvalsResponse> {
    const { dashboard, runs } = this.deps;
    const [agents, caseCounts, running] = await Promise.all([
      dashboard.listAgents(workspaceId),
      dashboard.caseCounts(workspaceId),
      dashboard.runningRuns(workspaceId),
    ]);

    const out: RunAllEvalsResponse = { started: [], skipped: [] };
    for (const a of agents) {
      const skip = (reason: RunAllEvalsSkipReason) =>
        out.skipped.push({ agent_id: a.id, agent_name: a.name, reason });
      if ((caseCounts.get(a.id) ?? 0) === 0) {
        skip('no_eval_cases');
        continue;
      }
      if (running.has(a.id)) {
        skip('eval_run_in_progress');
        continue;
      }
      try {
        const res = await runs.startRun(workspaceId, a.id, logger);
        out.started.push({ agent_id: a.id, run_id: res.run_id });
      } catch (err) {
        if (err instanceof NotFoundError) continue;
        const reason = SKIP_REASONS.find((r) => err instanceof AppError && err.code === r);
        if (reason) {
          skip(reason);
          continue;
        }
        logger.error(
          { agent_id: a.id, err: err instanceof Error ? err.message : 'unknown' },
          'eval run-all: start failed',
        );
      }
    }
    return out;
  }

  async compare(
    workspaceId: string,
    agentId: string,
    runA: string,
    runB: string,
  ): Promise<EvalRunComparison> {
    if (runA === runB) throw new ValidationError('Pick two different runs');
    const { promotion } = this.deps;
    const [a, b] = await Promise.all([
      promotion.storedRun(workspaceId, agentId, runA),
      promotion.storedRun(workspaceId, agentId, runB),
    ]);
    if (!a || !b) throw new NotFoundError('Eval run not found');
    this.assertCompleted(a);
    this.assertCompleted(b);

    const { earlier, later } = orderPair(a, b);
    const refs = [...earlier.config.skills, ...later.config.skills].map((s) => ({
      skillId: s.id,
      version: s.version,
    }));
    const [bodies, agent] = await Promise.all([
      promotion.skillVersionBodies(workspaceId, refs),
      promotion.currentAgentConfig(workspaceId, agentId),
    ]);
    if (!agent) throw new NotFoundError('Agent not found');

    const plan = await this.plan(workspaceId, later, agent, bodies);
    const restoreIds = plan.restore.map((r) => r.skillId);
    const affected = await promotion.otherAgentsLinking(workspaceId, agentId, restoreIds);

    const promote: EvalPromotePreview = {
      run_id: later.id,
      run_agent_version: later.config.agent_version,
      current_agent_version: agent.version,
      is_current: plan.isCurrent,
      skills_to_restore: plan.restore.map((r) => ({
        skill_id: r.skillId,
        name: r.name,
        current_version: r.currentVersion,
        recorded_version: r.recordedVersion,
      })),
      affected_agents: affected,
      deleted_skills: plan.deleted.map((d) => ({ skill_id: d.skillId, name: d.name })),
    };

    return {
      agent_id: agentId,
      earlier: toCompared(earlier),
      later: toCompared(later),
      case_sets: caseSetDiff(earlier.cases, later.cases),
      config_changes: configChanges(earlier.config, later.config),
      skill_changes: skillChanges(earlier.config.skills, later.config.skills, bodies),
      promote,
    };
  }

  async promote(
    workspaceId: string,
    agentId: string,
    runId: string,
  ): Promise<PromoteEvalRunResponse> {
    const { promotion } = this.deps;
    const run = await promotion.storedRun(workspaceId, agentId, runId);
    if (!run) throw new NotFoundError('Eval run not found');
    this.assertCompleted(run);
    const agent = await promotion.currentAgentConfig(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const bodies = await promotion.skillVersionBodies(
      workspaceId,
      run.config.skills.map((s) => ({ skillId: s.id, version: s.version })),
    );
    const plan = await this.plan(workspaceId, run, agent, bodies);
    if (plan.isCurrent) {
      throw new AppError('eval_promote_noop', 'This is the current configuration', 409);
    }

    const result = await promotion.applyPromotion(workspaceId, {
      agentId,
      provider: run.config.provider,
      model: run.config.model,
      systemPrompt: run.config.system_prompt,
      strategy: run.config.strategy,
      links: plan.links,
      restore: plan.restore.map((r) => ({
        skillId: r.skillId,
        body: r.body,
        note: restoreNote(r.recordedVersion),
      })),
    });

    return {
      agent_id: agentId,
      agent_version: result.agentVersion,
      run_agent_version: run.config.agent_version,
      restored_skills: result.restored.map((r) => ({ skill_id: r.skillId, version: r.version })),
    };
  }

  private assertCompleted(run: StoredRun): void {
    if (run.status !== 'completed') {
      throw new AppError('eval_run_not_completed', 'Only completed runs can be used', 422);
    }
  }

  private async plan(
    workspaceId: string,
    run: StoredRun,
    agent: CurrentAgentConfig,
    bodies: Map<string, Map<number, string>>,
  ): Promise<PromotionPlan> {
    const skills = await this.deps.promotion.skillsByIds(
      workspaceId,
      run.config.skills.map((s) => s.id),
    );
    return planPromotion(run.config, agent, skills, bodies);
  }
}

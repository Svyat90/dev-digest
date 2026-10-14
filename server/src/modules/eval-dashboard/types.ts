import type {
  CiFailOn,
  EvalComparedRun,
  EvalRunCaseRef,
  Provider,
  ReviewStrategy,
  StartEvalRunResponse,
} from '@devdigest/shared';

/** Minimal logger the dashboard service needs (structurally a Fastify/pino logger). */
export interface DashboardLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/**
 * Local structural port over `container.evals`. A module may not import another
 * module's files, so the one use case "Run all agents" calls is declared here;
 * `routes.ts` assigns `container.evals` to it, where drift becomes a compile error.
 */
export interface EvalRunStarter {
  startRun(
    workspaceId: string,
    agentId: string,
    logger: DashboardLogger,
  ): Promise<StartEvalRunResponse>;
}

export interface DashboardAgentRow {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  enabled: boolean;
}

export interface RecallSample {
  agentId: string;
  startedAt: Date;
  recall: number | null;
}

/** A stored run with its config and the case revisions it covered. */
export type StoredRun = EvalComparedRun & { cases: EvalRunCaseRef[] };

export interface CurrentAgentConfig {
  id: string;
  name: string;
  version: number;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  outputSchema: unknown;
  ciFailOn: CiFailOn;
  repoIntel: boolean;
  links: { skillId: string; enabled: boolean }[];
}

export interface SkillSnapshot {
  id: string;
  name: string;
  body: string;
  version: number;
}

export interface PromotionWrite {
  agentId: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  links: { skillId: string; enabled: boolean }[];
  restore: { skillId: string; body: string; note: string }[];
}

export interface PromotionResult {
  agentVersion: number;
  restored: { skillId: string; version: number }[];
}

import type { FastifyBaseLogger } from 'fastify';
import type { AgentRow, FindingRow } from '../../db/rows.js';
import type { ReviewRepository } from './repository.js';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskScore {
  score: number;
  level: RiskLevel;
  computedAt: string;
}

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 5,
  major: 3,
  minor: 1,
  info: 0,
};

export function weightOf(finding: FindingRow, agent: AgentRow | undefined): number {
  const base = SEVERITY_WEIGHT[finding.severity] ?? 0;
  const boost = agent?.name === 'security' ? Number(process.env.RISK_SECURITY_BOOST ?? '1.5') : 1;
  return base * boost;
}

export function levelOf(score: number): RiskLevel {
  if (score >= 7) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

export async function scorePull(
  repo: ReviewRepository,
  workspaceId: string,
  prId: string,
  log: FastifyBaseLogger,
): Promise<RiskScore> {
  const findings = await repo.listFindingsForPull(workspaceId, prId);
  const agents = await repo.listAgents(workspaceId);
  const byId = new Map(agents.map((a) => [a.id, a]));

  let total = 0;
  for (const f of findings) {
    total += weightOf(f.finding, byId.get(f.agentId ?? ''));
  }
  const score = Math.min(10, Math.round(total * 10) / 10);
  log.info({ prId, score }, 'risk scored');

  return { score, level: levelOf(score), computedAt: new Date(Date.now()).toISOString() };
}

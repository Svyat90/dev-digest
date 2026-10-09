import type { CostReportRepository } from './repository.js';

export interface CostReportDeps {
  repo: Pick<CostReportRepository, 'listAgents' | 'costForDay'>;
}

export interface AgentCost {
  agentId: string;
  name: string;
  days: { day: string; costUsd: number }[];
  totalUsd: number;
  perDayAvgUsd: number;
}

export class CostReportService {
  constructor(private deps: CostReportDeps) {}

  async report(workspaceId: string, from: Date, days: number): Promise<AgentCost[]> {
    const agents = await this.deps.repo.listAgents(workspaceId);
    const out: AgentCost[] = [];
    for (const agent of agents) {
      const rows: { day: string; costUsd: number }[] = [];
      for (let i = 0; i < days; i++) {
        const day = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
        const costUsd = await this.deps.repo.costForDay(workspaceId, agent.id, day);
        rows.push({ day: day.toISOString().slice(0, 10), costUsd });
      }
      const totalUsd = rows.reduce((s, r) => s + r.costUsd, 0);
      out.push({ agentId: agent.id, name: agent.name, days: rows, totalUsd, perDayAvgUsd: totalUsd / days });
    }
    return out;
  }
}

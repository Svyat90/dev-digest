/**
 * Promotion plan: what promoting a recorded eval run changes.
 *
 * Pure on purpose (`domain-is-pure`): the plan is computed from values the
 * caller loaded, so it can never reach a model or a database.
 */
import type { EvalRunConfig, Provider, ReviewStrategy } from '@devdigest/shared';

export interface PromotionAgentState {
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  links: readonly { skillId: string; enabled: boolean }[];
}

export interface PromotionSkillState {
  id: string;
  name: string;
  body: string;
  version: number;
}

export interface PromotionPlan {
  isCurrent: boolean;
  links: { skillId: string; enabled: boolean }[];
  restore: {
    skillId: string;
    name: string;
    currentVersion: number;
    recordedVersion: number;
    body: string;
  }[];
  deleted: { skillId: string; name: string }[];
}

/** The note on a skill version written by a promotion. */
export function restoreNote(recordedVersion: number): string {
  return `Restored from v${recordedVersion} by Promote`;
}

export function planPromotion(
  record: EvalRunConfig,
  agent: PromotionAgentState,
  skills: readonly PromotionSkillState[],
  bodies: ReadonlyMap<string, ReadonlyMap<number, string>>,
): PromotionPlan {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const recorded = [...record.skills].sort((a, b) => a.order - b.order);

  const links: PromotionPlan['links'] = [];
  const restore: PromotionPlan['restore'] = [];
  const deleted: PromotionPlan['deleted'] = [];

  for (const r of recorded) {
    const current = byId.get(r.id);
    if (!current) {
      deleted.push({ skillId: r.id, name: r.name });
      continue;
    }
    links.push({ skillId: r.id, enabled: r.link_enabled });
    const body = bodies.get(r.id)?.get(r.version) ?? r.body;
    if (body !== null && body !== undefined && body !== current.body) {
      restore.push({
        skillId: r.id,
        name: current.name,
        currentVersion: current.version,
        recordedVersion: r.version,
        body,
      });
    }
  }

  const sameLinks =
    agent.links.length === links.length &&
    agent.links.every(
      (l, i) => l.skillId === links[i]!.skillId && l.enabled === links[i]!.enabled,
    );

  const isCurrent =
    agent.provider === record.provider &&
    agent.model === record.model &&
    agent.systemPrompt === record.system_prompt &&
    agent.strategy === record.strategy &&
    sameLinks &&
    restore.length === 0;

  return { isCurrent, links, restore, deleted };
}

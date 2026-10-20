import { describe, it, expect } from 'vitest';
import type { EvalRunConfig, EvalRunSkill } from '@devdigest/shared';
import {
  planPromotion,
  restoreNote,
  type PromotionAgentState,
  type PromotionSkillState,
} from '../src/domain/evals/promote.js';

const rSkill = (id: string, order: number, over: Partial<EvalRunSkill> = {}): EvalRunSkill => ({
  id,
  name: `skill-${id}`,
  description: '',
  version: 1,
  order,
  link_enabled: true,
  skill_enabled: true,
  body: `body-${id}`,
  ...over,
});

const record = (skills: EvalRunSkill[]): EvalRunConfig => ({
  agent_version: 3,
  provider: 'openai',
  model: 'm',
  system_prompt: 'p',
  strategy: 'single-pass',
  skills,
});

const agentFor = (skills: EvalRunSkill[], over: Partial<PromotionAgentState> = {}): PromotionAgentState => ({
  provider: 'openai',
  model: 'm',
  systemPrompt: 'p',
  strategy: 'single-pass',
  links: [...skills]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ skillId: s.id, enabled: s.link_enabled })),
  ...over,
});

const state = (id: string, body = `body-${id}`, version = 1): PromotionSkillState => ({
  id,
  name: `skill-${id}`,
  body,
  version,
});

const noBodies = new Map<string, Map<number, string>>();

describe('planPromotion', () => {
  it('is current when everything equals the record', () => {
    const s = [rSkill('a', 0)];
    const plan = planPromotion(record(s), agentFor(s), [state('a')], noBodies);
    expect(plan.isCurrent).toBe(true);
    expect(plan.restore).toEqual([]);
  });

  it('restores a skill whose body changed since, links unchanged', () => {
    const s = [rSkill('a', 0)];
    const plan = planPromotion(record(s), agentFor(s), [state('a', 'edited', 2)], noBodies);
    expect(plan.isCurrent).toBe(false);
    expect(plan.restore).toEqual([
      { skillId: 'a', name: 'skill-a', currentVersion: 2, recordedVersion: 1, body: 'body-a' },
    ]);
    expect(plan.links).toEqual([{ skillId: 'a', enabled: true }]);
  });

  it('is not current when the prompt was edited', () => {
    const s = [rSkill('a', 0)];
    const plan = planPromotion(
      record(s),
      agentFor(s, { systemPrompt: 'edited' }),
      [state('a')],
      noBodies,
    );
    expect(plan.isCurrent).toBe(false);
  });

  it('leaves out a deleted skill and orders links by recorded order', () => {
    const s = [rSkill('c', 2), rSkill('a', 0, { link_enabled: false }), rSkill('b', 1)];
    const plan = planPromotion(
      record([s[0]!, s[1]!, s[2]!]),
      agentFor([]),
      [state('a'), state('c')],
      noBodies,
    );
    expect(plan.links).toEqual([
      { skillId: 'a', enabled: false },
      { skillId: 'c', enabled: true },
    ]);
    expect(plan.deleted).toEqual([{ skillId: 'b', name: 'skill-b' }]);
  });

  it('restores an inactive skill from the version map', () => {
    const s = [rSkill('a', 0, { body: null, version: 4 })];
    const bodies = new Map([['a', new Map([[4, 'old body']])]]);
    const plan = planPromotion(record(s), agentFor(s), [state('a', 'new', 5)], bodies);
    expect(plan.restore[0]).toMatchObject({ skillId: 'a', recordedVersion: 4, body: 'old body' });
  });

  it('does not restore a skill with no known body', () => {
    const s = [rSkill('a', 0, { body: null })];
    const plan = planPromotion(record(s), agentFor(s), [state('a', 'x')], noBodies);
    expect(plan.restore).toEqual([]);
  });
});

describe('restoreNote', () => {
  it('names the recorded version', () => {
    expect(restoreNote(6)).toBe('Restored from v6 by Promote');
  });
});

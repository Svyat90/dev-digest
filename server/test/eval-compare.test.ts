import { describe, it, expect } from 'vitest';
import type { EvalRunConfig } from '@devdigest/shared';
import { configChanges, orderPair, skillChanges } from '../src/domain/evals/compare.js';

type Skill = EvalRunConfig['skills'][number];
const skill = (id: string, version: number, body: string | null = null): Skill => ({
  id,
  name: `skill-${id}`,
  description: '',
  version,
  order: 0,
  link_enabled: true,
  skill_enabled: true,
  body,
});
const cfg = (over: Partial<EvalRunConfig> = {}): EvalRunConfig => ({
  agent_version: 7,
  provider: 'openai',
  model: 'm1',
  system_prompt: 'p',
  strategy: 'single-pass',
  skills: [],
  ...over,
});
const none = new Map<string, Map<number, string>>();

describe('orderPair', () => {
  it('puts the earlier run first whatever the argument order', () => {
    const old = { id: 'a', started_at: '2026-10-01T00:00:00Z' };
    const recent = { id: 'b', started_at: '2026-10-02T00:00:00Z' };
    expect(orderPair(recent, old)).toEqual({ earlier: old, later: recent });
    expect(orderPair(old, recent)).toEqual({ earlier: old, later: recent });
  });
});

describe('configChanges', () => {
  it('lists changed model and strategy in field order, skipping equal provider', () => {
    const changes = configChanges(cfg(), cfg({ model: 'm2', strategy: 'map-reduce' }));
    expect(changes.map((c) => c.field)).toEqual(['model', 'strategy']);
    expect(changes[0]).toEqual({ field: 'model', from: 'm1', to: 'm2' });
    expect(configChanges(cfg(), cfg())).toEqual([]);
  });
});

describe('skillChanges', () => {
  it('reports an added skill with its body from the map', () => {
    const bodies = new Map([['s1', new Map([[1, 'BODY']])]]);
    const out = skillChanges([], [skill('s1', 1)], bodies);
    expect(out).toEqual([
      expect.objectContaining({ skill_id: 's1', change: 'added', from_body: null, to_body: 'BODY' }),
    ]);
  });

  it('reports a version change; missing earlier body is null', () => {
    const bodies = new Map([['s1', new Map([[3, 'NEW']])]]);
    const out = skillChanges([skill('s1', 2)], [skill('s1', 3)], bodies);
    expect(out).toEqual([
      expect.objectContaining({
        change: 'version_changed',
        from_version: 2,
        to_version: 3,
        from_body: null,
        to_body: 'NEW',
      }),
    ]);
  });

  it('lists removed after later skills and nothing for identical sets', () => {
    const out = skillChanges([skill('a', 1), skill('b', 1)], [skill('a', 1), skill('c', 1)], none);
    expect(out.map((c) => [c.skill_id, c.change])).toEqual([
      ['c', 'added'],
      ['b', 'removed'],
    ]);
    expect(skillChanges([skill('a', 1)], [skill('a', 1)], none)).toEqual([]);
  });
});

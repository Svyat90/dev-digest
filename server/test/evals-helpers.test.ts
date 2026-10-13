import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import {
  buildRunConfig,
  capDescription,
  caseNameFromTitle,
  decideCaseCreation,
  errorReason,
  evalTaskLine,
  expectedCount,
  frozenDiff,
  mapWithConcurrency,
  skillBlocks,
  uniqueCaseName,
} from '../src/modules/evals/helpers.js';
import { MAX_FROZEN_DIFF_CHARS } from '../src/modules/evals/constants.js';
import type { AgentConfigSource, CaseCreationInput, FindingForCase } from '../src/modules/evals/types.js';

const PATCH = '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "x",\n   redisUrl: y,';

function finding(over: Partial<FindingForCase['finding']> = {}): FindingForCase['finding'] {
  return {
    id: 'f1',
    file: 'src/config.ts',
    startLine: 11,
    endLine: 11,
    kind: 'bug',
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    acceptedAt: new Date('2026-10-01T00:00:00Z'),
    dismissedAt: null,
    ...over,
  };
}

function input(over: Partial<CaseCreationInput> = {}): CaseCreationInput {
  return {
    finding: finding(),
    reviewAgentId: 'a1',
    agentExists: true,
    patch: PATCH,
    diff: parseUnifiedDiff(frozenDiff('src/config.ts', PATCH)),
    ...over,
  };
}

describe('caseNameFromTitle / uniqueCaseName', () => {
  it('makes a kebab-case identifier', () => {
    expect(caseNameFromTitle('SQL Injection in /users!')).toBe('sql-injection-in-users');
    expect(caseNameFromTitle('!!!')).toBe('finding');
    const long = caseNameFromTitle('word '.repeat(40));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('-')).toBe(false);
  });

  it('suffixes a taken name within 60 characters', () => {
    expect(uniqueCaseName('sql', new Set())).toBe('sql');
    expect(uniqueCaseName('sql', new Set(['sql']))).toBe('sql-2');
    expect(uniqueCaseName('sql', new Set(['sql', 'sql-2']))).toBe('sql-3');
    const base = `${'a'.repeat(59)}-b`;
    const out = uniqueCaseName(base, new Set([base]));
    expect(out).toHaveLength(60);
    expect(out.endsWith('-2')).toBe(true);
    expect(out).not.toContain('--');
  });
});

describe('frozenDiff / capDescription', () => {
  it('builds a self-contained unified diff', () => {
    expect(frozenDiff('a.ts', 'P')).toBe('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\nP');
    expect(capDescription(null)).toBe('');
    expect(capDescription('x'.repeat(5000))).toHaveLength(4000);
  });
});

describe('decideCaseCreation', () => {
  it('maps accepted to must_find and dismissed to must_not_flag', () => {
    const a = decideCaseCreation(input());
    expect(a).toMatchObject({ ok: true, expectationType: 'must_find' });
    const d = decideCaseCreation(
      input({ finding: finding({ acceptedAt: null, dismissedAt: new Date('2026-10-02T00:00:00Z') }) }),
    );
    expect(d).toMatchObject({ ok: true, expectationType: 'must_not_flag' });
  });

  it('refuses with the right code, in order', () => {
    const code = (i: CaseCreationInput) => {
      const r = decideCaseCreation(i);
      return r.ok ? 'ok' : r.code;
    };
    expect(code(input({ finding: finding({ acceptedAt: null }) }))).toBe('eval_case_undecided');
    expect(code(input({ reviewAgentId: null }))).toBe('eval_case_no_agent');
    expect(code(input({ agentExists: false }))).toBe('eval_case_agent_missing');
    expect(code(input({ patch: null }))).toBe('eval_case_no_diff');
    expect(code(input({ patch: 'x'.repeat(MAX_FROZEN_DIFF_CHARS + 1) }))).toBe('eval_case_diff_too_large');
    expect(code(input({ finding: finding({ startLine: 99, endLine: 99 }) }))).toBe('eval_case_lines_outside_diff');
  });

  it('allows a whole-file kind outside every hunk (EC5)', () => {
    const r = decideCaseCreation(input({ finding: finding({ kind: 'secret_leak', startLine: 99, endLine: 99 }) }));
    expect(r.ok).toBe(true);
  });
});

describe('buildRunConfig / skillBlocks', () => {
  const sk = (id: string, order: number, over: Partial<AgentConfigSource['skills'][number]> = {}) => ({
    id,
    name: `n${id}`,
    description: `d${id}`,
    body: `b${id}`,
    version: 1,
    order,
    linkEnabled: true,
    skillEnabled: true,
    ...over,
  });
  it('orders skills and nulls inactive bodies', () => {
    const cfg = buildRunConfig({
      agent: { id: 'a', name: 'A', version: 3, provider: 'openai', model: 'm', systemPrompt: 'sp', strategy: 'single' },
      skills: [sk('x', 2), sk('y', 0), sk('z', 1, { linkEnabled: false })],
    } as AgentConfigSource);
    expect(cfg.agent_version).toBe(3);
    expect(cfg.skills.map((s) => [s.id, s.order])).toEqual([['y', 0], ['z', 1], ['x', 2]]);
    expect(cfg.skills[1]!.body).toBeNull();
    expect(skillBlocks(cfg.skills)).toEqual(['### Skill: ny\ndy\n\nby', '### Skill: nx\ndx\n\nbx']);
  });
});

describe('small helpers', () => {
  it('counts expectations, task line, error reason', () => {
    expect(expectedCount('must_find')).toBe(1);
    expect(expectedCount('must_not_flag')).toBe(0);
    expect(evalTaskLine('Fix login')).toContain('Fix login');
    expect(errorReason(new Error('x'.repeat(300)))).toHaveLength(200);
    expect(errorReason('boom')).toBe('boom');
  });

  it('mapWithConcurrency bounds parallelism and keeps order', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
  });
});

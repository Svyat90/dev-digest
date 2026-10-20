import { describe, it, expect } from 'vitest';
import type {
  EvalCaseCheck,
  EvalCaseLastRun,
  EvalCaseProvenance,
  EvalRunConfig,
} from '@devdigest/shared';
import {
  expectedOutputFromProvenance,
  pickLastRun,
  revisionContentChanged,
  withSkillForRun,
  type RevisionContentLike,
} from '../src/domain/evals/case-editor.js';
import { isAgentRunRow } from '../src/domain/evals/run-owner.js';

const content = (over: Partial<RevisionContentLike> = {}): RevisionContentLike => ({
  inputDiff: '--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,2 @@\n a\n+b\n',
  inputMeta: { pr_title: 'Title', pr_description: '' },
  expectationType: 'must_find',
  expectation: { file: 'a.ts', start_line: 2, end_line: 2 },
  expectedOutput: [
    { severity: 'WARNING', category: 'bug', title: 'b', file: 'a.ts', start_line: 2, end_line: 2 },
  ],
  ...over,
});

const provenance: EvalCaseProvenance = {
  finding_id: 'f1',
  review_id: 'r1',
  pr_id: 'p1',
  pr_number: 7,
  repo_id: 'repo1',
  repo_full_name: 'o/n',
  decision: 'accepted',
  decided_at: '2026-10-01T00:00:00.000Z',
  agent_version: 2,
  severity: 'CRITICAL',
  category: 'security',
  title: 'SQL injection in query builder',
};

const check = (over: Partial<EvalCaseCheck> = {}): EvalCaseCheck => ({
  id: 'c1',
  case_revision_id: 'rev1',
  status: 'passed',
  started_at: '2026-10-13T10:04:00.000Z',
  finished_at: '2026-10-13T10:05:00.000Z',
  duration_ms: 60_000,
  expected: 1,
  got: 1,
  error: null,
  cost_usd: null,
  ...over,
});

const runResult: EvalCaseLastRun = {
  source: 'run',
  status: 'failed',
  expected: 1,
  got: 0,
  error: null,
  duration_ms: 1000,
  cost_usd: 0.01,
  finished_at: '2026-10-13T10:00:00.000Z',
};

type Skill = EvalRunConfig['skills'][number];
const skill = (id: string, order: number, over: Partial<Skill> = {}): Skill => ({
  id,
  name: `skill-${id}`,
  description: '',
  version: 1,
  order,
  link_enabled: true,
  skill_enabled: true,
  body: null,
  ...over,
});
const cfg = (skills: Skill[]): EvalRunConfig => ({
  agent_version: 3,
  provider: 'openai',
  model: 'm1',
  system_prompt: 'p',
  strategy: 'single-pass',
  skills,
});
const measured = { id: 's', name: 'measured', description: 'd', body: 'new body', version: 5 };

describe('revisionContentChanged', () => {
  it('ignores a name-only edit and detects a changed end line', () => {
    expect(revisionContentChanged(content(), content())).toBe(false);
    expect(
      revisionContentChanged(
        content(),
        content({ expectation: { file: 'a.ts', start_line: 2, end_line: 3 } }),
      ),
    ).toBe(true);
  });
});

describe('expectedOutputFromProvenance', () => {
  it('builds one finding for must_find and [] for must_not_flag', () => {
    const expectation = { file: 'db.ts', start_line: 4, end_line: 6 };
    expect(expectedOutputFromProvenance('must_find', expectation, provenance)).toEqual([
      {
        severity: 'CRITICAL',
        category: 'security',
        title: 'SQL injection in query builder',
        file: 'db.ts',
        start_line: 4,
        end_line: 6,
      },
    ]);
    expect(expectedOutputFromProvenance('must_not_flag', expectation, provenance)).toEqual([]);
  });
});

describe('pickLastRun', () => {
  it('returns the later of a finished check and a run result', () => {
    expect(pickLastRun(check(), runResult)).toMatchObject({
      source: 'check',
      status: 'passed',
      finished_at: '2026-10-13T10:05:00.000Z',
    });
  });

  it('skips a running check; both null → null', () => {
    expect(pickLastRun(check({ status: 'running', finished_at: null }), runResult)).toEqual(
      runResult,
    );
    expect(pickLastRun(null, null)).toBeNull();
  });
});

describe('withSkillForRun', () => {
  it('EC19: a linked but disabled skill is enabled at its order with the new body', () => {
    const input = cfg([skill('a', 0), skill('s', 1, { link_enabled: false, body: 'old' })]);
    const snapshot = structuredClone(input);
    const out = withSkillForRun(input, measured);
    expect(out.skills.find((s) => s.id === 's')).toEqual({
      id: 's',
      name: 'measured',
      description: 'd',
      version: 5,
      order: 1,
      link_enabled: true,
      skill_enabled: true,
      body: 'new body',
    });
    expect(out.skills).toHaveLength(2);
    expect(input).toEqual(snapshot);
  });

  it('EC20: an unlinked skill is appended after the others', () => {
    const input = cfg([skill('a', 0), skill('b', 2)]);
    const out = withSkillForRun(input, measured);
    expect(out.skills.at(-1)).toMatchObject({ id: 's', order: 3, skill_enabled: true });
    expect(input.skills).toHaveLength(2);
    expect(withSkillForRun(cfg([]), measured).skills[0]?.order).toBe(0);
  });
});

describe('isAgentRunRow', () => {
  it('narrows rows by agentId', () => {
    const rows: { id: string; agentId: string | null }[] = [
      { id: '1', agentId: 'ag' },
      { id: '2', agentId: null },
    ];
    const agentRows = rows.filter(isAgentRunRow);
    const ids: string[] = agentRows.map((r) => r.agentId);
    expect(ids).toEqual(['ag']);
  });
});

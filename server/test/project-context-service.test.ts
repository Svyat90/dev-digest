import { describe, expect, it, vi } from 'vitest';
import { MockRepoDocsReader } from '../src/adapters/mocks.js';
import { ValidationError } from '../src/platform/errors.js';
import {
  ProjectContextService,
  type ProjectContextDeps,
} from '../src/modules/project-context/service.js';

const WS = 'ws-1';
const REPO = { id: 'r1', owner: 'o', name: 'n', fullName: 'o/n' };
const count = (t: string) => t.length;

interface Fixture {
  files?: Record<string, string | { reason: 'missing' | 'outside_clone' | 'not_utf8' | 'unreadable' }>;
  cloned?: boolean;
  agentPaths?: string[];
  skills?: { id: string; name: string; paths: string[] }[];
}

function build(fx: Fixture = {}) {
  const reader = new MockRepoDocsReader({ files: fx.files ?? {}, cloned: fx.cloned ?? true });
  const readSpy = vi.spyOn(reader, 'read');
  const skills = fx.skills ?? [];
  const repo = {
    repoInWorkspace: vi.fn(async (_w: string, id: string) => (id === REPO.id ? REPO : undefined)),
    agentInWorkspace: vi.fn(async (_w: string, id: string) => (id === 'a1' ? { id, name: 'A' } : undefined)),
    skillInWorkspace: vi.fn(async (_w: string, id: string) => skills.find((s) => s.id === id)),
    agentDocPaths: vi.fn(async () => fx.agentPaths ?? []),
    skillDocPathsFor: vi.fn(async (_w: string, ids: string[]) =>
      skills.filter((s) => ids.includes(s.id)).flatMap((s) => s.paths.map((path) => ({ skillId: s.id, path }))),
    ),
    usage: vi.fn(async () => ({ agents: [], skills: [] })),
    replaceAgentDocs: vi.fn(async () => {}),
    replaceSkillDocs: vi.fn(async () => {}),
    appendAgentDoc: vi.fn(async () => {}),
    appendSkillDoc: vi.fn(async () => {}),
  };
  const deps: ProjectContextDeps = {
    repo,
    reader,
    count,
    roots: ['specs', 'docs', 'insights'],
    clonePathFor: () => '/clone',
    activeSkills: async () => skills.map((s) => ({ id: s.id, name: s.name })),
  };
  return { svc: new ProjectContextService(deps), repo, readSpy };
}

describe('listing', () => {
  it('caps rows at 500, reports the true total and lets q find the 501st', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 501; i++) files[`docs/d${String(i).padStart(3, '0')}.md`] = 'x';
    const { svc } = build({ files });
    const all = await svc.list(WS, 'r1');
    expect(all.documents).toHaveLength(500);
    expect(all.total).toBe(501);
    const found = await svc.list(WS, 'r1', 'D500');
    expect(found.documents.map((d) => d.path)).toEqual(['docs/d500.md']);
  });

  it('reports not_cloned', async () => {
    const { svc } = build({ cloned: false });
    expect((await svc.list(WS, 'r1')).status).toBe('not_cloned');
  });
});

describe('agent view', () => {
  it('lists inherited docs of active skills, counts a path once and reports left_out', async () => {
    const { svc } = build({
      files: {
        'docs/a.md': 'a'.repeat(3000),
        'docs/b.md': 'b'.repeat(4000),
        'docs/c.md': 'c'.repeat(4000),
        'docs/d.md': 'd'.repeat(4000),
      },
      agentPaths: ['docs/a.md', 'docs/gone.md'],
      skills: [
        { id: 's1', name: 'S1', paths: ['docs/a.md', 'docs/b.md', 'docs/c.md'] },
        { id: 's2', name: 'S2', paths: ['docs/d.md'] },
      ],
    });
    const v = await svc.agentView(WS, 'a1', 'r1');
    expect(v.own.find((d) => d.path === 'docs/gone.md')?.found).toBe(false);
    expect(v.inherited.map((d) => `${d.skill_name}:${d.path}`)).toContain('S1:docs/b.md');
    expect(v.total_tokens).toBe(3000 + 4000 + 4000 + 4000);
    expect(v.left_out).toEqual(['docs/d.md']);
  });
});

describe('resolveForRun', () => {
  it('touches no file when nothing is attached', async () => {
    const { svc, readSpy } = build({ files: { 'docs/a.md': 'x' } });
    expect(await svc.resolveForRun(WS, 'a1', REPO)).toEqual({ docs: [], skipped: [] });
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('orders agent then skills, dedupes, skips with reasons and truncates', async () => {
    const { svc } = build({
      files: {
        'docs/own.md': 'o',
        'docs/big.md': 'z'.repeat(10000),
        'docs/blank.md': '  \n',
        'docs/bin.md': { reason: 'not_utf8' },
        'docs/sk.md': 's',
      },
      agentPaths: ['docs/own.md', 'docs/missing.md', 'docs/blank.md', 'docs/bin.md', 'docs/big.md'],
      skills: [{ id: 's1', name: 'S1', paths: ['docs/own.md', 'docs/sk.md'] }],
    });
    const r = await svc.resolveForRun(WS, 'a1', REPO);
    expect(r.docs.map((d) => d.path)).toEqual(['docs/own.md', 'docs/big.md', 'docs/sk.md']);
    expect(r.docs[1]).toMatchObject({ tokens: 4000, truncated: true });
    expect(r.skipped).toEqual([
      { path: 'docs/missing.md', reason: 'missing' },
      { path: 'docs/blank.md', reason: 'empty' },
      { path: 'docs/bin.md', reason: 'not_utf8' },
    ]);
  });

  it('skips with not_cloned and over_cap', async () => {
    const nc = build({ cloned: false, agentPaths: ['docs/a.md'] });
    expect((await nc.svc.resolveForRun(WS, 'a1', REPO)).skipped).toEqual([
      { path: 'docs/a.md', reason: 'not_cloned' },
    ]);
    const big = 'x'.repeat(4000);
    const oc = build({
      files: { 'docs/1.md': big, 'docs/2.md': big, 'docs/3.md': big, 'docs/4.md': 'tiny' },
      agentPaths: ['docs/1.md', 'docs/2.md', 'docs/3.md', 'docs/4.md'],
    });
    const r = await oc.svc.resolveForRun(WS, 'a1', REPO);
    expect(r.docs).toHaveLength(3);
    expect(r.skipped).toEqual([{ path: 'docs/4.md', reason: 'over_cap' }]);
  });
});

describe('setAgentDocs', () => {
  it('rejects a traversal path and writes nothing', async () => {
    const { svc, repo } = build();
    await expect(svc.setAgentDocs(WS, 'a1', ['docs/ok.md', '../x.md'])).rejects.toBeInstanceOf(ValidationError);
    expect(repo.replaceAgentDocs).not.toHaveBeenCalled();
  });
});

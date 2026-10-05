/**
 * Project context routes (SPEC-01) against a real Postgres. Documents come from a
 * MockRepoDocsReader; agents/skills of a second workspace are inserted directly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockRepoDocsReader } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('Project context routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let agentId: string;
  let skillId: string;
  let foreign: { repoId: string; agentId: string; skillId: string };

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const db = pg.handle.db;
    const [ws] = await db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'ctx', fullName: 'acme/ctx' })
      .returning();
    repoId = repo!.id;
    const [agent] = await db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
    agentId = agent!.id;
    const [skill] = await db
      .insert(t.skills)
      .values({ workspaceId, name: 'ctx skill', description: 'd', type: 'rubric', source: 'manual', body: 'b' })
      .returning();
    skillId = skill!.id;

    const [other] = await db.insert(t.workspaces).values({ name: 'other workspace' }).returning();
    const otherWs = other!.id;
    const [fRepo] = await db
      .insert(t.repos)
      .values({ workspaceId: otherWs, owner: 'acme', name: 'foreign', fullName: 'acme/foreign' })
      .returning();
    const [fAgent] = await db
      .insert(t.agents)
      .values({
        workspaceId: otherWs,
        name: 'foreign agent',
        provider: 'openai',
        model: 'gpt-x',
        systemPrompt: 'p',
      })
      .returning();
    const [fSkill] = await db
      .insert(t.skills)
      .values({ workspaceId: otherWs, name: 'foreign skill', description: 'd', type: 'rubric', source: 'manual', body: 'b' })
      .returning();
    foreign = { repoId: fRepo!.id, agentId: fAgent!.id, skillId: fSkill!.id };
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        repoDocs: new MockRepoDocsReader({
          files: {
            'docs/specs/api.md': '# API\nhello',
            'server/INSIGHTS.md': '# Insights\nnote',
            'README.md': 'not a context doc',
          },
        }),
      },
    });
  }

  it('lists typed documents and returns content', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context/docs` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const byPath = Object.fromEntries(body.documents.map((x: { path: string; type: string }) => [x.path, x.type]));
    expect(byPath['docs/specs/api.md']).toBe('specs');
    expect(byPath['server/INSIGHTS.md']).toBe('insights');
    expect(byPath['README.md']).toBeUndefined();
    expect(body.total).toBe(2);
    const content = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/docs/content?path=docs/specs/api.md`,
    });
    expect(content.json()).toEqual({ path: 'docs/specs/api.md', content: '# API\nhello' });
    await app.close();
  });

  it('agent PUT/GET keeps order, POST keeps an existing position, versions unchanged', async () => {
    const app = await makeApp();
    const before = (await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, agentId)))[0]!.version;
    const put = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/context-docs`,
      payload: { paths: ['server/INSIGHTS.md', 'docs/specs/api.md'] },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: `/agents/${agentId}/context-docs?repo_id=${repoId}` });
    expect(get.json().own.map((x: { path: string }) => x.path)).toEqual([
      'server/INSIGHTS.md',
      'docs/specs/api.md',
    ]);
    const post = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context-docs`,
      payload: { path: 'server/INSIGHTS.md' },
    });
    expect(post.json().paths).toEqual(['server/INSIGHTS.md', 'docs/specs/api.md']);
    const after = (await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, agentId)))[0]!.version;
    expect(after).toBe(before);
    await app.close();
  });

  it('rejects non-attachable paths with 422 and stores nothing', async () => {
    const app = await makeApp();
    for (const bad of ['../../etc/passwd.md', '/abs/path.md', 'specs/notes.txt']) {
      const res = await app.inject({
        method: 'PUT',
        url: `/agents/${agentId}/context-docs`,
        payload: { paths: [bad] },
      });
      expect(res.statusCode).toBe(422);
    }
    const get = await app.inject({ method: 'GET', url: `/agents/${agentId}/context-docs?repo_id=${repoId}` });
    expect(get.json().own).toHaveLength(2);
    await app.close();
  });

  it('skill PUT/GET round-trips, version unchanged, usage counts agent and skill', async () => {
    const app = await makeApp();
    const put = await app.inject({
      method: 'PUT',
      url: `/skills/${skillId}/context-docs`,
      payload: { paths: ['docs/specs/api.md', 'server/INSIGHTS.md'] },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: `/skills/${skillId}/context-docs?repo_id=${repoId}` });
    expect(get.json().own.map((x: { path: string }) => x.path)).toEqual([
      'docs/specs/api.md',
      'server/INSIGHTS.md',
    ]);
    const skill = (await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, skillId)))[0]!;
    expect(skill.version).toBe(1);
    const usage = await app.inject({ method: 'GET', url: '/context-docs/usage?path=docs/specs/api.md' });
    const u = usage.json();
    expect(u.agents).toHaveLength(1);
    expect(u.skills).toHaveLength(1);
    await app.close();
  });

  it('another workspace answers 404', async () => {
    const app = await makeApp();
    const cases: Array<[string, string, object?]> = [
      ['GET', `/repos/${foreign.repoId}/context/docs`],
      ['GET', `/agents/${foreign.agentId}/context-docs?repo_id=${repoId}`],
      ['GET', `/agents/${agentId}/context-docs?repo_id=${foreign.repoId}`],
      ['PUT', `/agents/${foreign.agentId}/context-docs`, { paths: ['docs/a.md'] }],
      ['GET', `/skills/${foreign.skillId}/context-docs?repo_id=${repoId}`],
      ['PUT', `/skills/${foreign.skillId}/context-docs`, { paths: ['docs/a.md'] }],
    ];
    for (const [method, url, payload] of cases) {
      const res = await app.inject({ method: method as 'GET' | 'PUT', url, payload });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    await app.close();
  });
});

/**
 * GET /repos/lookup — resolve `owner/name` (+ optional PR number) to ids, against
 * a real Postgres. Read-only: rows are inserted directly, no GitHub, no clone.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('GET /repos/lookup (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'lookup-x', fullName: 'acme/lookup-x' })
      .returning();
    repoId = repo!.id;
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 7,
        title: 'Lookup me',
        author: 'marisa.koch',
        branch: 'feat/x',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'open',
      })
      .returning();
    prId = pr!.id;

    // A repo with the same shape in ANOTHER workspace: must be invisible.
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other workspace' })
      .returning();
    await pg.handle.db.insert(t.repos).values({
      workspaceId: other!.id,
      owner: 'acme',
      name: 'foreign-y',
      fullName: 'acme/foreign-y',
    });
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function get(query: string) {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/repos/lookup?${query}` });
    await app.close();
    return res;
  }

  it('resolves a repo and PR case-insensitively', async () => {
    const res = await get('full_name=ACME/lookup-x&pr_number=7');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      repo: { id: repoId, full_name: 'acme/lookup-x' },
      pull: { id: prId, number: 7 },
    });
  });

  it('prefers the exact spelling when two repos differ only in case', async () => {
    // Inserted first, so an unordered pick of the oldest row would return it.
    await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'Acme', name: 'Twin', fullName: 'Acme/Twin' });
    const [lower] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'twin', fullName: 'acme/twin' })
      .returning();

    const res = await get('full_name=acme/twin');
    expect(res.statusCode).toBe(200);
    expect(res.json().repo).toEqual({ id: lower!.id, full_name: 'acme/twin' });
  });

  it('returns pull: null when pr_number is omitted', async () => {
    const res = await get('full_name=acme/lookup-x');
    expect(res.statusCode).toBe(200);
    expect(res.json().pull).toBeNull();
  });

  it('404 repo_not_found for an unknown repo', async () => {
    const res = await get('full_name=acme/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('repo_not_found');
  });

  it('404 pr_not_found for a known repo with an unknown PR', async () => {
    const res = await get('full_name=acme/lookup-x&pr_number=999');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('pr_not_found');
  });

  it('404 for a repo that lives in another workspace', async () => {
    const res = await get('full_name=acme/foreign-y');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('repo_not_found');
  });

  it('422 for a malformed full_name', async () => {
    const res = await get('full_name=../x');
    expect(res.statusCode).toBe(422);
  });
});

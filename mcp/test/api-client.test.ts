import { describe, expect, it } from 'vitest';
import { DevDigestApi } from '../src/api/client.js';
import { ApiError, toToolError } from '../src/api/errors.js';
import { resolveRepoAndPull } from '../src/tools/resolve.js';
import { apiError, connect, fakeFetch, json } from './helpers/harness.js';
import { fail, ok, repoField } from '../src/tools/common.js';
import { z } from 'zod';

const API = 'http://localhost:3001';

function apiWith(routes: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(routes);
  return { api: new DevDigestApi({ baseUrl: API, fetchImpl: fake.fetch, httpTimeoutMs: 15000 }), calls: fake.calls };
}

describe('DevDigestApi', () => {
  it('lookup builds the encoded query and parses the result', async () => {
    const { api, calls } = apiWith({
      'GET /repos/lookup': () => ({
        repo: { id: 'r1', full_name: 'acme/payments-api', extra: 'dropped' },
        pull: { id: 'p1', number: 482 },
      }),
    });
    const res = await api.lookup('acme/payments-api', 482);
    expect(res).toEqual({ repo: { id: 'r1', full_name: 'acme/payments-api' }, pull: { id: 'p1', number: 482 } });
    expect(calls[0]?.url.search).toBe('?full_name=acme%2Fpayments-api&pr_number=482');
  });

  it('maps a refused connection to unreachable with the start-the-API hint', async () => {
    const refused = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as unknown as typeof fetch;
    const api = new DevDigestApi({ baseUrl: API, fetchImpl: refused, httpTimeoutMs: 15000 });
    const err = await api.listAgents().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe('unreachable');
    const out = toToolError(err, { apiUrl: API });
    expect(out.message).toContain(`not reachable at ${API}`);
    expect(out.next).toContain('./scripts/dev.sh');
  });

  it('names the imported repos on 404 repo_not_found', async () => {
    const { api } = apiWith({
      'GET /repos/lookup': () => apiError(404, 'repo_not_found', 'Repo x/y is not imported'),
      'GET /repos': () => json([{ id: '1', full_name: 'acme/a' }, { id: '2', full_name: 'acme/b' }]),
    });
    const err = await resolveRepoAndPull(api, 'x/y').catch((e: unknown) => e);
    const out = toToolError(err, { apiUrl: API });
    expect(out.error).toBe('repo_not_found');
    expect(out.message).toContain('acme/a, acme/b');
    expect(out.next).not.toBe('');
  });

  it('rejects a response missing a required field as shape', async () => {
    const { api } = apiWith({ 'GET /agents': () => [{ id: 'a1', name: 'Sec' }] });
    const err = await api.listAgents().catch((e: unknown) => e);
    expect((err as ApiError).kind).toBe('shape');
    const out = toToolError(err, { apiUrl: API });
    expect(out.message && out.next).toBeTruthy();
    expect(out.next).toContain('npm run build');
  });
});

describe('harness', () => {
  it('drives a real Client/McpServer pair and validates repo input', async () => {
    const h = await connect(
      (server, deps) => {
        server.registerTool('echo', { inputSchema: { repo: repoField } }, async ({ repo }) => {
          try {
            return ok(await deps.api.lookup(repo));
          } catch (e) {
            return fail(toToolError(e, { apiUrl: deps.config.apiUrl }));
          }
        });
      },
      { routes: { 'GET /repos/lookup': () => ({ repo: { id: 'r', full_name: 'a/b' }, pull: null }) } },
    );
    const good = await h.client.callTool({ name: 'echo', arguments: { repo: 'a/b' } });
    expect(z.object({ isError: z.undefined() }).safeParse(good).success).toBe(true);
    await expect(h.client.callTool({ name: 'echo', arguments: { repo: '../x' } })).resolves.toMatchObject({ isError: true });
    expect(h.calls).toHaveLength(1);
    await h.close();
  });
});

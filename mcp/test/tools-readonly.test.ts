import { afterEach, describe, expect, it } from 'vitest';
import { registerGetBlastRadius } from '../src/tools/get-blast-radius.js';
import { registerGetConventions } from '../src/tools/get-conventions.js';
import { registerListAgents } from '../src/tools/list-agents.js';
import type { ToolDeps } from '../src/tools/common.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiError, connect, json } from './helpers/harness.js';

type Harness = Awaited<ReturnType<typeof connect>>;
let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

function text(res: unknown): string {
  return ((res as { content: { text: string }[] }).content[0] as { text: string }).text;
}

const registerAll = (s: McpServer, d: ToolDeps): void => {
  registerListAgents(s, d);
  registerGetConventions(s, d);
  registerGetBlastRadius(s, d);
};

describe('read-only tools', () => {
  it('list_agents returns a concise list without system_prompt', async () => {
    const agents = Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`,
      name: `Agent ${i}`,
      description: 'd'.repeat(500),
      model: 'openai/gpt-4.1',
      enabled: true,
      system_prompt: 'SECRET PROMPT '.repeat(100),
      output_schema: { big: true },
    }));
    h = await connect(registerAll, { routes: { 'GET /agents': () => agents } });
    const res = await h.client.callTool({ name: 'list_agents', arguments: {} });
    expect(res.isError).toBeFalsy();
    const body = text(res);
    expect(body).not.toContain('system_prompt');
    expect(body).not.toContain('SECRET PROMPT');
    expect(body.length).toBeLessThan(4096);
    const parsed = JSON.parse(body) as { agents: { description: string }[] };
    expect(parsed.agents).toHaveLength(10);
    expect(parsed.agents[0]?.description.length).toBeLessThanOrEqual(160);
  });

  it('all three tools are read-only and declare no outputSchema', async () => {
    h = await connect(registerAll);
    const { tools } = await h.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_blast_radius', 'get_conventions', 'list_agents']);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.outputSchema).toBeUndefined();
    }
  });

  it('list_agents explains how to start the API when it is unreachable', async () => {
    const refused = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as unknown as typeof fetch;
    h = await connect(registerAll, { fetchImpl: refused });
    const res = await h.client.callTool({ name: 'list_agents', arguments: {} });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('./scripts/dev.sh');
  });

  it('get_conventions on an unknown repo names the imported repos in the error', async () => {
    h = await connect(registerAll, {
      routes: {
        'GET /repos/lookup': () => apiError(404, 'repo_not_found', 'nope'),
        'GET /repos': () => json([{ id: '1', full_name: 'acme/a' }, { id: '2', full_name: 'acme/b' }]),
      },
    });
    const res = await h.client.callTool({ name: 'get_conventions', arguments: { repo: 'x/y' } });
    expect(res.isError).toBe(true);
    const err = JSON.parse(text(res)) as { error: string; message: string; next: string };
    expect(err.error).toBe('repo_not_found');
    expect(err.message).toContain('acme/a, acme/b');
    expect(err.next).not.toBe('');
  });

  it('get_conventions returns accepted first, without snippets', async () => {
    const cand = (id: string, status: string) => ({
      id,
      category: 'naming',
      rule: `rule ${id}`,
      evidence_path: 'src/a.ts',
      evidence_start_line: 1,
      evidence_end_line: 3,
      status,
      snippet: 'SNIPPET',
    });
    h = await connect(registerAll, {
      routes: {
        'GET /repos/lookup': () => ({ repo: { id: 'r1', full_name: 'acme/a' }, pull: null }),
        'GET /repos/:id/conventions': () => ({
          scan: { status: 'ok', created_at: '2026-09-22T00:00:00Z' },
          repo: { full_name: 'acme/a' },
          candidates: [cand('p', 'pending'), cand('a', 'accepted')],
        }),
      },
    });
    const res = await h.client.callTool({ name: 'get_conventions', arguments: { repo: 'acme/a' } });
    const body = JSON.parse(text(res)) as { conventions: { rule: string; evidence: string }[]; truncated: boolean };
    expect(body.conventions.map((c) => c.rule)).toEqual(['rule a', 'rule p']);
    expect(body.conventions[0]?.evidence).toBe('src/a.ts:1-3');
    expect(text(res)).not.toContain('SNIPPET');
    expect(body.truncated).toBe(false);
  });

  it('get_conventions without a scan is an empty list, not an error', async () => {
    h = await connect(registerAll, {
      routes: {
        'GET /repos/lookup': () => ({ repo: { id: 'r1', full_name: 'acme/a' }, pull: null }),
        'GET /repos/:id/conventions': () => ({ scan: null, repo: { full_name: 'acme/a' }, candidates: [] }),
      },
    });
    const res = await h.client.callTool({ name: 'get_conventions', arguments: { repo: 'acme/a' } });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain('No conventions extracted yet');
  });

  it('get_blast_radius is a stub error and makes no API call', async () => {
    h = await connect(registerAll);
    const res = await h.client.callTool({ name: 'get_blast_radius', arguments: { repo: 'acme/a', pr_number: 1 } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('Not Implemented Yet');
    expect(h.calls).toHaveLength(0);
  });
});

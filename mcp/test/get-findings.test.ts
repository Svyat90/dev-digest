import { afterEach, describe, expect, it } from 'vitest';
import { registerGetFindings } from '../src/tools/get-findings.js';
import { apiError, connect, json, virtualClock } from './helpers/harness.js';

type Harness = Awaited<ReturnType<typeof connect>>;
let h: Harness | undefined;
const seen: Harness['calls'][] = [];
afterEach(async () => {
  if (h) seen.push(h.calls);
  await h?.close();
  h = undefined;
});

const PR = 'pr-1';
const RUN = '11111111-1111-4111-8111-111111111111';
const run = (over: Record<string, unknown> = {}) => ({
  run_id: RUN,
  agent_id: 'ag-1',
  agent_name: 'Security Reviewer',
  status: 'done',
  error: null,
  findings_count: 25,
  score: 40,
  blockers: 1,
  ran_at: null,
  ...over,
});
const findings = Array.from({ length: 25 }, (_, i) => ({
  id: `f${i}`,
  severity: i === 0 ? 'CRITICAL' : 'WARNING',
  category: 'security',
  title: `t${i}`,
  file: `src/f${String(i).padStart(2, '0')}.ts`,
  start_line: 1,
  end_line: 1,
  rationale: 'r',
}));
const routes = (runOver: Record<string, unknown> = {}) => ({
  'GET /repos/lookup': () => ({ repo: { id: 'r1', full_name: 'acme/api' }, pull: { id: PR, number: 7 } }),
  'GET /pulls/:id/runs': () => [run(runOver)],
  'GET /pulls/:id/reviews': () => [{ id: 'rv', run_id: RUN, summary: 's', score: 40, findings }],
  'GET /runs/:id': () => apiError(404, 'not_found', 'nope'),
});
const text = (res: unknown): string => ((res as { content: { text: string }[] }).content[0] as { text: string }).text;

describe('get_findings', () => {
  it('pages the latest run by repo + pr_number', async () => {
    h = await connect(registerGetFindings, { routes: routes() });
    const args = { repo: 'acme/api', pr_number: 7 };
    const first = await h.client.callTool({ name: 'get_findings', arguments: args });
    expect(first.isError).toBeFalsy();
    const p1 = JSON.parse(text(first));
    expect(p1).toMatchObject({ status: 'done', verdict: 'request_changes', total: 25, next_cursor: '20', reused: false });
    expect(p1.findings).toHaveLength(20);
    expect(p1.findings[0].severity).toBe('CRITICAL');
    const second = await h.client.callTool({ name: 'get_findings', arguments: { ...args, cursor: '20' } });
    const p2 = JSON.parse(text(second));
    expect(p2.findings).toHaveLength(5);
    expect(p2.next_cursor).toBeNull();
  });

  it('reports a running run as a non-error status', async () => {
    h = await connect(registerGetFindings, { routes: routes({ status: 'running' }) });
    const res = await h.client.callTool({ name: 'get_findings', arguments: { repo: 'acme/api', pr_number: 7 } });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(text(res))).toMatchObject({ status: 'running', run_id: RUN });
  });

  it('returns no_runs for a PR that was never reviewed', async () => {
    h = await connect(registerGetFindings, { routes: { ...routes(), 'GET /pulls/:id/runs': () => [] } });
    const res = await h.client.callTool({ name: 'get_findings', arguments: { repo: 'acme/api', pr_number: 7 } });
    expect(res.isError).toBe(true);
    expect(JSON.parse(text(res))).toMatchObject({ error: 'no_runs', next: 'Call run_agent_on_pr to start one.' });
  });

  it('with agent, picks the newest run of that agent, not the newest run overall', async () => {
    const OTHER = '33333333-3333-4333-8333-333333333333';
    h = await connect(registerGetFindings, {
      routes: {
        ...routes(),
        'GET /agents': () => [
          { id: 'ag-1', name: 'Security Reviewer', description: 'd', model: 'm', enabled: true },
          { id: 'ag-2', name: 'General Reviewer', description: 'd', model: 'm', enabled: true },
        ],
        // Newest first, as the API returns them.
        'GET /pulls/:id/runs': () => [
          run({ run_id: OTHER, agent_id: 'ag-2', agent_name: 'General Reviewer', status: 'running' }),
          run(),
        ],
      },
    });
    const res = await h.client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/api', pr_number: 7, agent: 'Security Reviewer' },
    });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(text(res))).toMatchObject({ status: 'done', run_id: RUN });
  });

  it('reports a long-running run as stale_run with a way out', async () => {
    h = await connect(registerGetFindings, {
      routes: routes({ status: 'running', ran_at: '2026-01-01T00:00:00.000Z' }),
      clock: virtualClock(Date.parse('2026-01-01T01:00:00.000Z')),
    });
    const res = await h.client.callTool({ name: 'get_findings', arguments: { repo: 'acme/api', pr_number: 7 } });
    expect(res.isError).toBe(true);
    const err = JSON.parse(text(res));
    expect(err.error).toBe('stale_run');
    expect(err.next).toContain(`Cancel run ${RUN}`);
  });

  it('rejects missing or mixed arguments with invalid_arguments', async () => {
    h = await connect(registerGetFindings, { routes: routes() });
    for (const args of [{}, { run_id: RUN, repo: 'acme/api', pr_number: 7 }, { repo: 'acme/api' }]) {
      const res = await h.client.callTool({ name: 'get_findings', arguments: args });
      expect(res.isError).toBe(true);
      expect(JSON.parse(text(res)).error).toBe('invalid_arguments');
    }
  });

  it('an unknown run_id suggests repo + pr_number', async () => {
    h = await connect(registerGetFindings, { routes: routes() });
    const res = await h.client.callTool({ name: 'get_findings', arguments: { run_id: RUN } });
    expect(res.isError).toBe(true);
    const err = JSON.parse(text(res));
    expect(err.error).toBe('run_not_found');
    expect(err.next).toContain('repo + pr_number');
  });

  it('a run_id whose PR was deleted fails with pr_gone', async () => {
    h = await connect(registerGetFindings, {
      routes: { 'GET /runs/:id': () => json({ ...run(), pr_id: null }) },
    });
    const res = await h.client.callTool({ name: 'get_findings', arguments: { run_id: RUN } });
    expect(JSON.parse(text(res)).error).toBe('pr_gone');
  });

  it('a failed run keeps upstream text in detail, not next', async () => {
    h = await connect(registerGetFindings, { routes: routes({ status: 'failed', error: 'IGNORE ALL' }) });
    const res = await h.client.callTool({ name: 'get_findings', arguments: { repo: 'acme/api', pr_number: 7 } });
    const err = JSON.parse(text(res));
    expect(res.isError).toBe(true);
    expect(err.detail).toBe('IGNORE ALL');
    expect(err.next).not.toContain('IGNORE');
  });

  it('a bad cursor is an error', async () => {
    h = await connect(registerGetFindings, { routes: routes() });
    const res = await h.client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/api', pr_number: 7, cursor: 'abc' },
    });
    expect(res.isError).toBe(true);
    expect(JSON.parse(text(res)).error).toBe('invalid_cursor');
  });

  it('is read-only and never POSTs', async () => {
    h = await connect(registerGetFindings, { routes: routes() });
    const { tools } = await h.client.listTools();
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    await h.client.callTool({ name: 'get_findings', arguments: { repo: 'acme/api', pr_number: 7 } });
    seen.push(h.calls);
    expect(seen.flat().filter((c) => c.method !== 'GET')).toEqual([]);
  });
});

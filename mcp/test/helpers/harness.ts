import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DevDigestApi } from '../../src/api/client.js';
import type { Config } from '../../src/config.js';
import type { Logger } from '../../src/log.js';
import type { Clock, ToolDeps } from '../../src/tools/common.js';

export interface FakeRequest {
  method: string;
  url: URL;
  path: string;
  body: unknown;
  signal: AbortSignal | undefined;
}

export type RouteHandler = (req: FakeRequest) => Response | unknown | Promise<Response | unknown>;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

export function apiError(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

function matches(pattern: string, path: string): boolean {
  const a = pattern.split('/');
  const b = path.split('/');
  return a.length === b.length && a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
}

/**
 * Fake fetch driven by `'METHOD /path'` routes (`:param` matches one segment).
 * Every request is recorded; an unrouted request throws a non-TypeError so the
 * test fails loudly instead of looking like an unreachable API.
 */
export function fakeFetch(routes: Record<string, RouteHandler>): {
  fetch: typeof fetch;
  calls: FakeRequest[];
} {
  const calls: FakeRequest[] = [];
  const impl = async (input: URL | string | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    const method = init?.method ?? 'GET';
    const req: FakeRequest = {
      method,
      url,
      path: url.pathname,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      signal: init?.signal ?? undefined,
    };
    calls.push(req);
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      return m === method && p !== undefined && matches(p, url.pathname);
    });
    if (!key) throw new Error(`fakeFetch: unrouted request ${method} ${url.pathname}`);
    const out = await routes[key]!(req);
    return out instanceof Response ? out : json(out);
  };
  return { fetch: impl as typeof fetch, calls };
}

/** Advances time without waiting; `sleep` rejects when the signal aborts. */
export function virtualClock(start = 0): Clock & { elapsed(): number } {
  let t = start;
  return {
    now: () => t,
    elapsed: () => t - start,
    sleep: async (ms, signal) => {
      if (signal?.aborted) throw signal.reason;
      t += ms;
      await Promise.resolve();
      if (signal?.aborted) throw signal.reason;
    },
  };
}

export interface ConnectOverrides {
  routes?: Record<string, RouteHandler>;
  fetchImpl?: typeof fetch;
  clock?: Clock;
  config?: Partial<Config>;
  pollIntervalMs?: number;
  progressIntervalMs?: number;
}

const silentLog: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** A real McpServer and Client linked over InMemoryTransport. */
export async function connect(
  register: (server: McpServer, deps: ToolDeps) => void,
  overrides: ConnectOverrides = {},
): Promise<{ client: Client; server: McpServer; deps: ToolDeps; calls: FakeRequest[]; close(): Promise<void> }> {
  const fake = fakeFetch(overrides.routes ?? {});
  const config: Config = { apiUrl: 'http://localhost:3001', runTimeoutMs: 600000, ...overrides.config };
  const deps: ToolDeps = {
    api: new DevDigestApi({
      baseUrl: config.apiUrl,
      fetchImpl: overrides.fetchImpl ?? fake.fetch,
      httpTimeoutMs: 15000,
    }),
    config,
    log: silentLog,
    clock: overrides.clock ?? virtualClock(),
    pollIntervalMs: overrides.pollIntervalMs ?? 5000,
    progressIntervalMs: overrides.progressIntervalMs ?? 10000,
  };
  const server = new McpServer({ name: 'devdigest', version: '0.0.0-test' });
  register(server, deps);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    server,
    deps,
    calls: fake.calls,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

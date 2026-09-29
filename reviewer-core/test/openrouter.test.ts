import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenRouterProvider } from '../src/llm/openrouter.js';

// A loopback stand-in for OpenRouter's non-streaming behaviour when an upstream
// provider stalls: headers go out at once, then keep-alive padding, never a body.
// The SDK's own `timeout` is cleared as soon as headers arrive, so only a
// deadline that also covers the body read can end this request.
let server: Server | undefined;
const timers: NodeJS.Timeout[] = [];

async function startStallingServer(): Promise<string> {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write(' ');
    timers.push(setInterval(() => res.write(' '), 20));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}

afterEach(async () => {
  timers.splice(0).forEach(clearInterval);
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

describe('OpenRouterProvider.completeStructured', () => {
  it('returns parsed data when the response completes within the deadline', async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'gen-1',
          object: 'chat.completion',
          created: 0,
          model: 'test/model',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
      );
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const llm = new OpenRouterProvider('test-key', { baseURL, deadlineMs: 2_000, maxRetries: 0 });

    const res = await llm.completeStructured({
      model: 'test/model',
      schema: z.object({ ok: z.boolean() }),
      schemaName: 'Probe',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res.data).toEqual({ ok: true });
    expect(res.tokensIn).toBe(3);
  });

  it('fails once the deadline passes even when headers arrived and the body never ends', async () => {
    const baseURL = await startStallingServer();
    const llm = new OpenRouterProvider('test-key', { baseURL, deadlineMs: 300, maxRetries: 0 });

    const call = llm.completeStructured({
      model: 'test/model',
      schema: z.object({ ok: z.boolean() }),
      schemaName: 'Probe',
      messages: [{ role: 'user', content: 'hi' }],
    });

    await expect(call).rejects.toThrow(/Probe exceeded the 300ms deadline/);
  }, 5_000);
});

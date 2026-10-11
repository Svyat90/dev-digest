import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ExternalServiceError, InvalidModelOutputError } from '../src/platform/errors.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { OpenAIProvider } from '../src/adapters/llm/openai.js';
import { AnthropicProvider } from '../src/adapters/llm/anthropic.js';

const req = {
  model: 'test-model',
  schema: z.object({ ok: z.boolean() }),
  schemaName: 'Probe',
  messages: [{ role: 'user' as const, content: 'hi' }],
  maxRetries: 0,
};

describe('invalid structured output is a typed error', () => {
  it('MockLLMProvider rejects with InvalidModelOutputError (still an ExternalServiceError, 502)', async () => {
    const llm = new MockLLMProvider('openai', { structured: { nope: 1 } });
    const err = await llm.completeStructured(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidModelOutputError);
    expect(err).toBeInstanceOf(ExternalServiceError);
    expect((err as InvalidModelOutputError).statusCode).toBe(502);
  });

  it('OpenAIProvider rejects with InvalidModelOutputError after one stub call', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'not json' } }], usage: {} });
    const p = new OpenAIProvider('test-key');
    (p as unknown as { client: unknown }).client = { chat: { completions: { create } } };
    await expect(p.completeStructured(req)).rejects.toBeInstanceOf(InvalidModelOutputError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('AnthropicProvider rejects with InvalidModelOutputError after one stub call', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'not json' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const p = new AnthropicProvider('test-key');
    (p as unknown as { client: unknown }).client = { messages: { create } };
    await expect(p.completeStructured(req)).rejects.toBeInstanceOf(InvalidModelOutputError);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

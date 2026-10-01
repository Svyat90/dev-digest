import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, INSTRUCTIONS } from '../src/server.js';
import { connect } from './helpers/harness.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

describe('createServer', () => {
  async function linked() {
    // The harness only supplies fake-fetch deps; the server under test is createServer's.
    const h = await connect(() => {});
    await h.close();
    const server = createServer(h.deps);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    close = async () => {
      await client.close();
      await server.close();
    };
    return client;
  }

  it('exposes exactly the five tools with the agreed annotations and schemas', async () => {
    const client = await linked();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['get_blast_radius', 'get_conventions', 'get_findings', 'list_agents', 'run_agent_on_pr'].sort(),
    );
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(t.name !== 'run_agent_on_pr');
      expect(t.outputSchema, t.name).toBeUndefined();
      expect((t.description ?? '').length, t.name).toBeLessThan(2048);
      for (const [key, prop] of Object.entries(t.inputSchema.properties ?? {})) {
        expect(['string', 'number', 'integer', 'boolean'], `${t.name}.${key}`).toContain(
          (prop as { type?: string }).type,
        );
      }
    }
    const run = tools.find((t) => t.name === 'run_agent_on_pr');
    expect(run?.annotations?.openWorldHint).toBe(true);
    const blast = tools.find((t) => t.name === 'get_blast_radius');
    expect(blast?.description).not.toMatch(/^NOT IMPLEMENTED/);
    expect(blast?.title).not.toMatch(/not implemented/i);
    expect(blast?.annotations?.readOnlyHint).toBe(true);
  });

  it('has short instructions and no resources or prompts capability', async () => {
    const client = await linked();
    const text = client.getInstructions() ?? '';
    expect(text).toBe(INSTRUCTIONS);
    expect(text.length).toBeLessThanOrEqual(2048);
    expect(text.split('\n').length).toBeLessThanOrEqual(5);
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
    expect(client.getServerCapabilities()?.prompts).toBeUndefined();
    await expect(client.listResources()).rejects.toThrow();
    await expect(client.listPrompts()).rejects.toThrow();
  });
});

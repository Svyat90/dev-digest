import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { DevDigestApi } from '../api/client.js';
import type { ToolError } from '../api/errors.js';
import { STALE_RUN_MS, type Config } from '../config.js';
import type { Logger } from '../log.js';

export { truncate } from '../api/errors.js';

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

export interface ToolDeps {
  api: DevDigestApi;
  config: Config;
  log: Logger;
  clock: Clock;
  pollIntervalMs: number;
  progressIntervalMs: number;
}

export const repoField = z
  .string()
  .regex(/^(?!\.+\/)[\w.-]+\/(?!\.+$)[\w.-]+$/, 'repo must be "owner/name", e.g. "acme/payments-api"')
  .describe('GitHub repository as "owner/name", e.g. "acme/payments-api"');
export const prNumberField = z.number().int().positive().describe('Pull request number, e.g. 482');
export const agentField = z
  .string()
  .min(1)
  .max(200)
  .describe('Reviewer agent id (uuid) or exact agent name, as returned by list_agents');

/** The failure for a run stuck in `running`; `runId` is a validated uuid. */
export function staleRunError(runId: string): ToolError {
  return {
    error: 'stale_run',
    message: `This review run has been running for over ${Math.round(STALE_RUN_MS / 60_000)} minutes and is likely stuck.`,
    next: `Cancel run ${runId} in the DevDigest studio (or restart the API, which marks stuck runs failed), then call run_agent_on_pr again.`,
  };
}

export function ok(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

export function fail(err: ToolError): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(err) }], isError: true };
}

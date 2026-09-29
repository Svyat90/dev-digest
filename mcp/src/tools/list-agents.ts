import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toToolError } from '../api/errors.js';
import { fail, ok, truncate, type ToolDeps } from './common.js';

const DESCRIPTION_MAX = 160;

export function registerListAgents(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'list_agents',
    {
      title: 'List reviewer agents',
      description:
        'List DevDigest reviewer agents (id, name, model, enabled). Call this first to get a valid agent id or name for run_agent_on_pr / get_findings.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async (_args, extra) => {
      try {
        const agents = await deps.api.listAgents(extra.signal);
        return ok({
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            model: a.model,
            enabled: a.enabled,
            description: truncate(a.description, DESCRIPTION_MAX),
          })),
        });
      } catch (e) {
        if (extra.signal.aborted) throw e;
        return fail(toToolError(e, { apiUrl: deps.config.apiUrl }));
      }
    },
  );
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fail, prNumberField, repoField, type ToolDeps } from './common.js';

/** Stub: the real implementation is the L04 homework. Makes no API call. */
export function registerGetBlastRadius(server: McpServer, _deps: ToolDeps): void {
  server.registerTool(
    'get_blast_radius',
    {
      title: 'Get blast radius (not implemented)',
      description:
        'NOT IMPLEMENTED YET. Will return the files and symbols affected by a pull request (repo-intel blast radius). Today it returns an error; use get_findings or get_conventions instead.',
      inputSchema: { repo: repoField, pr_number: prNumberField },
      annotations: { readOnlyHint: true },
    },
    async () =>
      fail({
        error: 'not_implemented',
        message: 'Not Implemented Yet',
        next: 'Use get_findings for review results or get_conventions for repo rules.',
      }),
  );
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ToolFailure, toToolError } from '../api/errors.js';
import { fail, ok, prNumberField, repoField, type ToolDeps } from './common.js';
import { resolveRepoAndPull } from './resolve.js';

export function registerGetBlastRadius(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_blast_radius',
    {
      title: 'Get blast radius',
      description:
        "Returns, for each symbol declared in a PR's changed files, its callers (file:line), the HTTP endpoints and the crons in those callers' files. Call it before reviewing a PR, to see which callers, endpoints and crons the change can break; it reads a precomputed index, with no LLM cost.",
      inputSchema: { repo: repoField, pr_number: prNumberField },
      annotations: { readOnlyHint: true },
    },
    async ({ repo, pr_number }, extra) => {
      try {
        const found = await resolveRepoAndPull(deps.api, repo, pr_number, extra.signal);
        if (!found.pull) {
          throw new ToolFailure({
            error: 'pr_not_found',
            message: `PR #${pr_number} is not imported for ${repo}.`,
            next: "Open the repo's PR list in the DevDigest studio (it syncs from GitHub), then retry.",
          });
        }
        const blast = await deps.api.blast(found.pull.id, extra.signal);
        return ok({
          repo,
          pr_number,
          summary: blast.summary,
          degraded: blast.degraded,
          reason: blast.reason,
          index_status: blast.index_status,
          downstream: blast.downstream.map((g) => ({
            symbol: g.symbol,
            callers: g.callers.map((c) => `${c.file}:${c.line} (${c.name})`),
            endpoints: g.endpoints_affected,
            crons: g.crons_affected,
          })),
        });
      } catch (e) {
        if (extra.signal.aborted) throw e;
        return fail(toToolError(e, { apiUrl: deps.config.apiUrl, repo, prNumber: pr_number }));
      }
    },
  );
}

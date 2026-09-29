import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ToolFailure, toToolError, truncate } from '../api/errors.js';
import type { RunState } from '../api/schemas.js';
import { buildDonePayload } from '../domain/findings.js';
import { agentField, fail, ok, prNumberField, repoField, type ToolDeps } from './common.js';
import { resolveAgent, resolveRepoAndPull } from './resolve.js';

const DETAIL_MAX = 300;

export function registerGetFindings(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_findings',
    {
      title: 'Get review findings',
      description:
        'Get the verdict and findings of a finished DevDigest review run. Pass run_id, or repo + pr_number (optional agent) for the latest run. Paginated (limit, cursor). Read-only; never starts a review.',
      inputSchema: {
        run_id: z.string().uuid().optional().describe('Run id from run_agent_on_pr'),
        repo: repoField.optional(),
        pr_number: prNumberField.optional(),
        agent: agentField.optional(),
        limit: z.number().int().min(1).max(50).optional().describe('Findings per page, default 20'),
        cursor: z.string().max(16).optional().describe('next_cursor from the previous page'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ run_id, repo, pr_number, agent, limit, cursor }, extra) => {
      const signal = extra.signal;
      try {
        const byRepo = repo !== undefined && pr_number !== undefined;
        const valid = run_id !== undefined ? repo === undefined && pr_number === undefined && agent === undefined : byRepo;
        if (!valid) {
          return fail({
            error: 'invalid_arguments',
            message: 'Pass either run_id, or repo together with pr_number (agent is optional there).',
            next: 'Call get_findings with run_id, or with repo "owner/name" and pr_number.',
          });
        }

        let run: RunState;
        let prId: string;
        if (run_id !== undefined) {
          run = await deps.api.getRun(run_id, signal);
          if (!run.pr_id) {
            return fail({
              error: 'pr_gone',
              message: 'The PR of this run was deleted.',
              next: 'Call get_findings with repo + pr_number to read the latest run of a PR.',
            });
          }
          prId = run.pr_id;
        } else {
          const found = await resolveRepoAndPull(deps.api, repo!, pr_number, signal);
          if (!found.pull) {
            throw new ToolFailure({
              error: 'pr_not_found',
              message: `PR #${pr_number} is not imported for ${repo}.`,
              next: "Open the repo's PR list in the DevDigest studio (it syncs from GitHub), then retry.",
            });
          }
          prId = found.pull.id;
          const wanted = agent !== undefined ? await resolveAgent(deps.api, agent, signal) : undefined;
          const runs = await deps.api.listRuns(prId, signal);
          const latest = wanted ? runs.find((r) => r.agent_id === wanted.id) : runs[0];
          if (!latest) {
            return fail({
              error: 'no_runs',
              message: `No review run found for PR #${pr_number} of ${repo}.`,
              next: 'Call run_agent_on_pr to start one.',
            });
          }
          run = latest;
        }

        if (run.status === 'failed' || run.status === 'cancelled') {
          return fail({
            error: run.status === 'failed' ? 'run_failed' : 'run_cancelled',
            message: `The run ${run.status}.`,
            next: 'Call run_agent_on_pr to start a new run.',
            ...(run.error ? { detail: truncate(run.error, DETAIL_MAX) } : {}),
          });
        }
        if (run.status !== 'done') {
          return ok({
            status: 'running',
            run_id: run.run_id,
            next: `Call get_findings with run_id "${run.run_id}" in about a minute.`,
          });
        }

        const reviews = await deps.api.reviewsForPull(prId, signal);
        const review = reviews.find((r) => r.run_id === run.run_id);
        if (!review) {
          return fail({
            error: 'review_missing',
            message: 'The run is done but no review is stored for it.',
            next: 'Call run_agent_on_pr to produce a fresh review.',
          });
        }
        const payload = buildDonePayload({
          run,
          review,
          limit,
          cursor,
          context: {
            ...(repo !== undefined ? { repo } : {}),
            ...(pr_number !== undefined ? { pr_number } : {}),
            reused: false,
          },
        });
        if ('error' in payload) {
          return fail({
            error: 'invalid_cursor',
            message: 'The cursor is not valid for this result.',
            next: 'Omit cursor to start from the first page, or pass next_cursor from the previous page.',
          });
        }
        return ok(payload);
      } catch (e) {
        if (signal.aborted) throw e;
        return fail(toToolError(e, { apiUrl: deps.config.apiUrl, repo, prNumber: pr_number }));
      }
    },
  );
}

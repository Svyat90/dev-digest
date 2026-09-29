import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toToolError, truncate } from '../api/errors.js';
import { buildDonePayload } from '../domain/findings.js';
import { waitForRun } from '../domain/wait.js';
import { agentField, fail, ok, prNumberField, repoField, type ToolDeps } from './common.js';
import { resolveAgent, resolveRepoAndPull } from './resolve.js';

const PAGE_LIMIT = 20;
const DETAIL_MAX = 300;

export function registerRunAgentOnPr(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'run_agent_on_pr',
    {
      title: 'Run a reviewer agent on a PR',
      description:
        "Run one DevDigest reviewer agent on a pull request and return its findings: starts the review, waits (up to ~10 min, with progress), then returns {verdict, findings}. Spends LLM budget. If still running at the deadline it returns status 'running' and a run_id; then call get_findings.",
      inputSchema: { repo: repoField, pr_number: prNumberField, agent: agentField },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async ({ repo, pr_number, agent }, extra) => {
      const { signal } = extra;
      try {
        const found = await resolveAgent(deps.api, agent, signal);
        const { pull } = await resolveRepoAndPull(deps.api, repo, pr_number, signal);
        if (!pull) {
          // Defensive: lookup with a pr_number should 404 with pr_not_found instead.
          return fail({
            error: 'pr_not_found',
            message: `PR #${pr_number} is not imported for ${repo}.`,
            next: "Open the repo's PR list in the DevDigest studio (it syncs from GitHub), then retry.",
          });
        }

        // Reuse a running run of the same agent so a retry does not spend the budget twice.
        const active = (await deps.api.activeRuns(pull.id, signal)).find((r) => r.agent_id === found.id);
        let runId: string;
        let reused = false;
        if (active) {
          runId = active.run_id;
          reused = true;
        } else {
          const started = await deps.api.startReview(pull.id, found.id, signal);
          const first = started.runs[0];
          if (!first) {
            return fail({
              error: 'run_not_started',
              message: 'The API accepted the review but returned no run.',
              next: 'Retry run_agent_on_pr, or check the terminal running the API.',
            });
          }
          runId = first.run_id;
        }

        const progressToken = extra._meta?.progressToken;
        const deadlineS = Math.round(deps.config.runTimeoutMs / 1000);
        let lastSentMs = -Infinity;
        let lastProgress = -1;
        const onTick = (elapsedMs: number): void => {
          if (progressToken === undefined) return;
          if (elapsedMs - lastSentMs < deps.progressIntervalMs) return;
          const progress = Math.max(Math.round(elapsedMs / 1000), lastProgress + 1);
          lastSentMs = elapsedMs;
          lastProgress = progress;
          extra
            .sendNotification({
              method: 'notifications/progress',
              params: {
                progressToken,
                progress,
                total: Math.max(deadlineS, progress),
                message: `review running — ${Math.round(elapsedMs / 1000)} s`,
              },
            })
            .catch(() => {});
        };

        const outcome = await waitForRun({
          getRun: (s) => deps.api.getRun(runId, s),
          clock: deps.clock,
          pollIntervalMs: deps.pollIntervalMs,
          deadlineMs: deps.config.runTimeoutMs,
          signal,
          onTick,
        });

        switch (outcome.kind) {
          case 'done': {
            const reviews = await deps.api.reviewsForPull(pull.id, signal);
            const review = reviews.find((r) => r.run_id === runId);
            if (!review) {
              return fail({
                error: 'review_missing',
                message: 'The run finished but its review was not found.',
                next: `Call get_findings with run_id ${runId}.`,
              });
            }
            const payload = buildDonePayload({
              run: { ...outcome.run, agent_name: outcome.run.agent_name ?? found.name },
              review,
              limit: PAGE_LIMIT,
              context: { repo, pr_number, reused },
            });
            if ('error' in payload) {
              return fail({
                error: 'internal_error',
                message: 'Could not build the findings page.',
                next: `Call get_findings with run_id ${runId}.`,
              });
            }
            return ok(payload);
          }
          case 'timeout':
            return ok({
              status: 'running',
              run_id: runId,
              elapsed_s: deadlineS,
              reused,
              next: `The review is still running. Call get_findings with run_id ${runId} later.`,
            });
          case 'failed':
          case 'cancelled': {
            const failed = outcome.kind === 'failed';
            return fail({
              error: failed ? 'run_failed' : 'run_cancelled',
              message: failed ? 'The review run failed.' : 'The review run was cancelled.',
              next: failed
                ? 'Check the API logs, then retry run_agent_on_pr.'
                : 'Retry run_agent_on_pr to start a new run.',
              ...(outcome.run.error ? { detail: truncate(outcome.run.error, DETAIL_MAX) } : {}),
            });
          }
          case 'aborted':
            // The client cancelled: rethrow so the SDK drops the response.
            throw signal.reason ?? new Error('aborted');
          default: {
            const never: never = outcome;
            return never;
          }
        }
      } catch (e) {
        if (signal.aborted) throw e;
        return fail(toToolError(e, { apiUrl: deps.config.apiUrl, repo, prNumber: pr_number }));
      }
    },
  );
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toToolError } from '../api/errors.js';
import { fail, ok, repoField, truncate, type ToolDeps } from './common.js';
import { resolveRepoAndPull } from './resolve.js';

const MAX_CONVENTIONS = 50;
const RULE_MAX = 300;

export function registerGetConventions(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_conventions',
    {
      title: 'Get repository conventions',
      description:
        'Get the coding conventions DevDigest extracted for a repository (L02 Conventions Extractor): rule, category, evidence file:lines, status.',
      inputSchema: { repo: repoField },
      annotations: { readOnlyHint: true },
    },
    async ({ repo }, extra) => {
      try {
        const { repo: found } = await resolveRepoAndPull(deps.api, repo, undefined, extra.signal);
        const list = await deps.api.conventions(found.id, extra.signal);
        if (!list.scan) {
          return ok({
            repo: list.repo.full_name,
            scan: null,
            conventions: [],
            truncated: false,
            next: 'No conventions extracted yet — run the Conventions Extractor in the DevDigest studio.',
          });
        }
        // Accepted first, then the rest (the server already hides rejected).
        const rank = (s: string): number => (s === 'accepted' ? 0 : 1);
        const sorted = list.candidates
          .map((c, i) => ({ c, i }))
          .sort((a, b) => rank(a.c.status) - rank(b.c.status) || a.i - b.i)
          .map(({ c }) => c);
        return ok({
          repo: list.repo.full_name,
          scan: { status: list.scan.status, created_at: list.scan.created_at },
          conventions: sorted.slice(0, MAX_CONVENTIONS).map((c) => ({
            category: c.category ?? null,
            rule: truncate(c.rule, RULE_MAX),
            evidence: `${c.evidence_path}:${c.evidence_start_line}-${c.evidence_end_line}`,
            status: c.status,
          })),
          truncated: sorted.length > MAX_CONVENTIONS,
        });
      } catch (e) {
        if (extra.signal.aborted) throw e;
        return fail(toToolError(e, { apiUrl: deps.config.apiUrl, repo }));
      }
    },
  );
}

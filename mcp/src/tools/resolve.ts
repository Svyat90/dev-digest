import type { DevDigestApi } from '../api/client.js';
import { ApiError, ToolFailure, toToolError } from '../api/errors.js';
import type { AgentLite, LookupResult } from '../api/schemas.js';

const HINT_REPOS = 10;

/** Exact id match first, then a case-insensitive name match. */
export async function resolveAgent(
  api: DevDigestApi,
  agent: string,
  signal?: AbortSignal,
): Promise<AgentLite> {
  const agents = await api.listAgents(signal);
  const byId = agents.find((a) => a.id === agent);
  if (byId) return byId;
  const wanted = agent.toLowerCase();
  const byName = agents.filter((a) => a.name.toLowerCase() === wanted);
  if (byName.length === 1 && byName[0]) return byName[0];
  if (byName.length > 1) {
    throw new ToolFailure({
      error: 'agent_ambiguous',
      message: `Several agents are named "${agent}".`,
      next: 'Pass the id from list_agents.',
    });
  }
  throw new ToolFailure({
    error: 'agent_not_found',
    message: `Agent "${agent}" not found.`,
    next: 'Call list_agents and pass one of the returned ids or names.',
  });
}

/**
 * Resolves `owner/name` (and optionally a PR number). A missing repo gets an
 * actionable error naming the imported repos; a failure fetching that hint only
 * drops the hint.
 */
export async function resolveRepoAndPull(
  api: DevDigestApi,
  repo: string,
  prNumber?: number,
  signal?: AbortSignal,
): Promise<LookupResult> {
  try {
    return await api.lookup(repo, prNumber, signal);
  } catch (err) {
    if (!(err instanceof ApiError) || err.kind !== 'http') throw err;
    let importedRepos: string[] | undefined;
    if (err.code === 'repo_not_found') {
      try {
        importedRepos = (await api.listRepos(signal)).slice(0, HINT_REPOS).map((r) => r.full_name);
      } catch {
        if (signal?.aborted) throw err;
      }
    }
    throw new ToolFailure(toToolError(err, { apiUrl: api.baseUrl, repo, prNumber, importedRepos }));
  }
}

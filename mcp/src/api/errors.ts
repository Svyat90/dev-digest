import { truncate } from '../domain/text.js';

export { truncate };

export interface ToolError {
  error: string;
  message: string;
  next: string;
  detail?: string;
}

const DETAIL_MAX = 300;

export type ApiErrorKind = 'unreachable' | 'timeout' | 'http' | 'shape';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly route: string,
    readonly status?: number,
    readonly code?: string,
    readonly timeoutMs?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A failure a tool already turned into its final shape (e.g. agent_not_found). */
export class ToolFailure extends Error {
  constructor(readonly toolError: ToolError) {
    super(toolError.message);
    this.name = 'ToolFailure';
  }
}

export interface ErrorContext {
  apiUrl: string;
  repo?: string;
  prNumber?: number;
  importedRepos?: string[];
}

/**
 * Maps any failure to `{ error, message, next, detail? }`. Untrusted upstream
 * text (API message, run error) goes only into `detail`; `next` is built from
 * fixed templates plus validated identifiers.
 */
export function toToolError(err: unknown, ctx: ErrorContext): ToolError {
  if (err instanceof ToolFailure) return err.toolError;
  if (!(err instanceof ApiError)) {
    return {
      error: 'internal_error',
      message: 'Unexpected error in the DevDigest MCP server.',
      next: 'Check the stderr of the mcp process and retry.',
      detail: truncate(err instanceof Error ? err.message : String(err), DETAIL_MAX),
    };
  }
  const detail = err.kind === 'http' ? truncate(err.message, DETAIL_MAX) : undefined;
  const withDetail = (e: ToolError): ToolError => (detail ? { ...e, detail } : e);

  switch (err.kind) {
    case 'unreachable':
      return {
        error: 'api_unreachable',
        message: `DevDigest API not reachable at ${ctx.apiUrl}.`,
        next: 'Start it with ./scripts/dev.sh or set DEVDIGEST_API_URL, then retry.',
      };
    case 'timeout':
      return {
        error: 'api_timeout',
        message: `API at ${ctx.apiUrl} did not answer in ${Math.round((err.timeoutMs ?? 15000) / 1000)} s.`,
        next: `Check GET ${ctx.apiUrl}/health, then retry.`,
      };
    case 'shape':
      return {
        error: 'api_shape_mismatch',
        message: `Unexpected response from ${err.route}: mcp and server are out of sync.`,
        next: 'Rebuild mcp (cd mcp && npm run build) and restart the MCP server.',
      };
    case 'http':
      break;
  }

  const status = err.status ?? 0;
  const code = err.code ?? 'http_error';
  if (status === 404 && code === 'repo_not_found') {
    const imported = ctx.importedRepos?.length ? ` Imported: ${ctx.importedRepos.join(', ')}.` : '';
    return withDetail({
      error: 'repo_not_found',
      message: `Repo ${ctx.repo ?? '(unknown)'} is not imported.${imported}`,
      next: 'Add it in the DevDigest studio (Add repository), or use one of the imported repos.',
    });
  }
  if (status === 404 && code === 'pr_not_found') {
    return withDetail({
      error: 'pr_not_found',
      message: `PR #${ctx.prNumber ?? '?'} is not imported for ${ctx.repo ?? '(unknown)'}.`,
      next: "Open the repo's PR list in the DevDigest studio (it syncs from GitHub), then retry.",
    });
  }
  if (status === 404 && err.route.startsWith('/runs/')) {
    return withDetail({
      error: 'run_not_found',
      message: 'Run not found.',
      next: 'Call get_findings with repo + pr_number to find the latest run.',
    });
  }
  if (status === 429) {
    return withDetail({
      error: 'rate_limited',
      message: 'Rate limited (10 review starts per minute).',
      next: 'Wait a minute and retry.',
    });
  }
  if (status >= 500) {
    return withDetail({
      error: 'api_error',
      message: `API error ${status} ${code}.`,
      next: 'Check the terminal running the API, then retry.',
    });
  }
  return withDetail({
    error: 'api_rejected',
    message: `API rejected the request (${code}).`,
    next: 'Check the arguments (list_agents for valid agents) and retry.',
  });
}

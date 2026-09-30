import type { z } from 'zod';
import { ApiError } from './errors.js';
import {
  ActiveRunList,
  AgentList,
  ApiErrorBody,
  ConventionListLite,
  LookupResult,
  RepoList,
  ReviewLiteList,
  ReviewRunResponseLite,
  RunState,
  RunStateList,
} from './schemas.js';

export interface DevDigestApiOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  httpTimeoutMs: number;
}

interface RequestOptions<S extends z.ZodTypeAny> {
  method?: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  schema: S;
  signal?: AbortSignal;
}

const enc = encodeURIComponent;

/** Typed fetch wrapper over the DevDigest REST API. Knows HTTP, not MCP. */
export class DevDigestApi {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly httpTimeoutMs: number;

  constructor(opts: DevDigestApiOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.httpTimeoutMs = opts.httpTimeoutMs;
  }

  listAgents(signal?: AbortSignal) {
    return this.request({ path: '/agents', schema: AgentList, signal });
  }

  listRepos(signal?: AbortSignal) {
    return this.request({ path: '/repos', schema: RepoList, signal });
  }

  lookup(fullName: string, prNumber?: number, signal?: AbortSignal) {
    return this.request({
      path: '/repos/lookup',
      query: { full_name: fullName, pr_number: prNumber },
      schema: LookupResult,
      signal,
    });
  }

  activeRuns(prId: string, signal?: AbortSignal) {
    return this.request({ path: `/pulls/${enc(prId)}/runs/active`, schema: ActiveRunList, signal });
  }

  listRuns(prId: string, signal?: AbortSignal) {
    return this.request({ path: `/pulls/${enc(prId)}/runs`, schema: RunStateList, signal });
  }

  getRun(runId: string, signal?: AbortSignal) {
    return this.request({ path: `/runs/${enc(runId)}`, schema: RunState, signal });
  }

  startReview(prId: string, agentId: string, signal?: AbortSignal) {
    return this.request({
      method: 'POST',
      path: `/pulls/${enc(prId)}/review`,
      body: { agentId },
      schema: ReviewRunResponseLite,
      signal,
    });
  }

  reviewsForPull(prId: string, signal?: AbortSignal) {
    return this.request({ path: `/pulls/${enc(prId)}/reviews`, schema: ReviewLiteList, signal });
  }

  conventions(repoId: string, signal?: AbortSignal) {
    return this.request({
      path: `/repos/${enc(repoId)}/conventions`,
      schema: ConventionListLite,
      signal,
    });
  }

  private async request<S extends z.ZodTypeAny>(opts: RequestOptions<S>): Promise<z.infer<S>> {
    const method = opts.method ?? 'GET';
    const url = new URL(this.baseUrl + opts.path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const timeoutSignal = AbortSignal.timeout(this.httpTimeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;
    const hasBody = opts.body !== undefined;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        signal,
        headers: hasBody ? { 'content-type': 'application/json' } : undefined,
        body: hasBody ? JSON.stringify(opts.body) : undefined,
      });
    } catch (err) {
      // A caller abort is never mapped: the SDK drops the response.
      if (opts.signal?.aborted) throw err;
      if (timeoutSignal.aborted) {
        throw new ApiError('timeout', 'request timed out', opts.path, undefined, undefined, this.httpTimeoutMs);
      }
      if (err instanceof TypeError) {
        const cause = (err as { cause?: { code?: string } }).cause;
        throw new ApiError('unreachable', cause?.code ?? err.message, opts.path);
      }
      throw err;
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch (err) {
      // The timeout also covers reading the body: report it as one, not as a shape error.
      if (opts.signal?.aborted) throw err;
      if (timeoutSignal.aborted) {
        throw new ApiError('timeout', 'response body timed out', opts.path, undefined, undefined, this.httpTimeoutMs);
      }
      if (res.ok) throw new ApiError('shape', 'response is not JSON', opts.path);
      payload = undefined;
    }

    if (!res.ok) {
      const body = ApiErrorBody.safeParse(payload);
      throw new ApiError(
        'http',
        body.success ? body.data.error.message : res.statusText || `HTTP ${res.status}`,
        opts.path,
        res.status,
        body.success ? body.data.error.code : undefined,
      );
    }

    const parsed = opts.schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError('shape', parsed.error.issues[0]?.message ?? 'invalid shape', opts.path);
    }
    return parsed.data;
  }
}

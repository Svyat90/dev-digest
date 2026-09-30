import { z } from 'zod';

export const POLL_INTERVAL_MS = 5000;
export const PROGRESS_INTERVAL_MS = 10000;
export const HTTP_TIMEOUT_MS = 15000;
// A run still `running` this long after `ran_at` is treated as stuck: the API reaps
// orphaned runs only on boot. Generous, because a map-reduce review of a large PR
// makes one model call per file.
export const STALE_RUN_MS = 30 * 60_000;

export const DEFAULT_API_URL = 'http://localhost:3001';
export const DEFAULT_RUN_TIMEOUT_MS = 600000;
// Kept below the `.mcp.json` tool timeout of 900000 ms.
const MIN_RUN_TIMEOUT_MS = 10000;
const MAX_RUN_TIMEOUT_MS = 840000;

export interface Config {
  apiUrl: string;
  runTimeoutMs: number;
}

const apiUrlSchema = z
  .string()
  .url()
  .refine((v) => {
    const p = new URL(v).protocol;
    return p === 'http:' || p === 'https:';
  }, 'must be http: or https:');

const runTimeoutSchema = z.coerce.number().int().min(MIN_RUN_TIMEOUT_MS).max(MAX_RUN_TIMEOUT_MS);

/** A bad env value never throws: it falls back to the default and yields a warning. */
export function loadConfig(env: NodeJS.ProcessEnv): { config: Config; warnings: string[] } {
  const warnings: string[] = [];

  let apiUrl = DEFAULT_API_URL;
  const rawUrl = env.DEVDIGEST_API_URL;
  if (rawUrl !== undefined && rawUrl !== '') {
    const parsed = apiUrlSchema.safeParse(rawUrl);
    if (parsed.success) apiUrl = parsed.data.replace(/\/+$/, '');
    else warnings.push(`DEVDIGEST_API_URL is invalid, using ${DEFAULT_API_URL}`);
  }

  let runTimeoutMs = DEFAULT_RUN_TIMEOUT_MS;
  const rawTimeout = env.DEVDIGEST_RUN_TIMEOUT_MS;
  if (rawTimeout !== undefined && rawTimeout !== '') {
    const parsed = runTimeoutSchema.safeParse(rawTimeout);
    if (parsed.success) runTimeoutMs = parsed.data;
    else {
      warnings.push(
        `DEVDIGEST_RUN_TIMEOUT_MS must be an integer in ${MIN_RUN_TIMEOUT_MS}-${MAX_RUN_TIMEOUT_MS}, using ${DEFAULT_RUN_TIMEOUT_MS}`,
      );
    }
  }

  return { config: { apiUrl, runTimeoutMs }, warnings };
}

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DevDigestApi } from './api/client.js';
import { HTTP_TIMEOUT_MS, loadConfig, POLL_INTERVAL_MS, PROGRESS_INTERVAL_MS } from './config.js';
import { createLogger } from './log.js';
import { createServer } from './server.js';
import { realClock } from './tools/common.js';

const log = createLogger();

function fatal(err: unknown): never {
  log.error(`fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
}
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

const { config, warnings } = loadConfig(process.env);
for (const w of warnings) log.warn(w);

const api = new DevDigestApi({ baseUrl: config.apiUrl, httpTimeoutMs: HTTP_TIMEOUT_MS });
const server = createServer({
  api,
  config,
  log,
  clock: realClock,
  pollIntervalMs: POLL_INTERVAL_MS,
  progressIntervalMs: PROGRESS_INTERVAL_MS,
});

await server.connect(new StdioServerTransport());
log.info(`ready (api: ${config.apiUrl})`);

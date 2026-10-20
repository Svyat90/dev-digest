import type { preHandlerAsyncHookHandler } from 'fastify';
import type { Container } from '../../platform/container.js';
import { AppError } from '../../platform/errors.js';
import { getContext } from './context.js';

/**
 * preHandler of every eval run-start route: counts one start against the
 * workspace's shared limit and refuses with 429 before the handler runs, so a
 * refused request starts nothing and makes no model call.
 */
export function runStartGuard(container: Container): preHandlerAsyncHookHandler {
  return async (req) => {
    const { workspaceId } = await getContext(container, req);
    const res = container.runStartLimiter.tryStart(workspaceId);
    if (!res.allowed) {
      throw new AppError(
        'run_start_rate_limited',
        'Too many runs — try again in a minute',
        429,
        { retry_after_ms: res.retryAfterMs },
      );
    }
  };
}

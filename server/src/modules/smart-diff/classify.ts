import type { SmartDiffRole } from '@devdigest/shared';
import { ROLE_RULES } from './constants.js';

/**
 * Classifies one repo-relative file path into a Smart Diff role. Pure: no
 * HTTP, no DB, no I/O. First matching rule in `ROLE_RULES` (precedence order)
 * wins; `core` is the fallback.
 */
export function classifyFile(path: string): SmartDiffRole {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const segments = normalized.split('/');
  const base = segments[segments.length - 1] ?? normalized;
  for (const rule of ROLE_RULES) {
    if (rule.test(normalized, base)) return rule.role;
  }
  return 'core';
}

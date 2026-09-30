import type { SmartDiffRole } from '@devdigest/shared';

/**
 * Smart Diff DISPLAY order for the Files-changed groups. This is separate
 * from `ROLE_RULES` precedence below: a file's role is decided by precedence,
 * then groups are rendered in this order (empty groups are omitted by the
 * caller).
 */
export const ROLE_ORDER = ['core', 'tests', 'wiring', 'docs', 'boilerplate'] as const satisfies readonly SmartDiffRole[];

/** A single classification rule: matches a normalised path and its basename. */
interface RoleRule {
  role: SmartDiffRole;
  test: (path: string, base: string) => boolean;
}

/** True when `name` appears as a whole `/`-delimited segment of `path`. */
function hasSegment(path: string, name: string): boolean {
  return path.split('/').includes(name);
}

/**
 * Classification rules in PRECEDENCE order: boilerplate -> tests -> wiring ->
 * docs. `classifyFile` returns the first rule whose `test` matches; `core` is
 * the fallback when none does (this includes `package.json`, which is in no
 * list on purpose — see the Smart Diff plan, Design > Data rules).
 */
export const ROLE_RULES: readonly RoleRule[] = [
  {
    role: 'boilerplate',
    test: (path, base) =>
      /\.lock$/.test(base) ||
      base === 'pnpm-lock.yaml' ||
      base === 'package-lock.json' ||
      base === 'yarn.lock' ||
      /\.snap$/.test(base) ||
      /\.min\.js$/.test(base) ||
      base.includes('.generated.') ||
      /^dist\//.test(path) ||
      /^build\//.test(path) ||
      hasSegment(path, '__snapshots__'),
  },
  {
    // Checked before wiring/docs: a snapshot under `__tests__/__snapshots__/`
    // is claimed by the boilerplate rule above (boilerplate precedes tests),
    // and `e2e/README.md` is claimed here rather than by docs (tests precede
    // docs) — both are intentional, contested decisions.
    role: 'tests',
    test: (path, base) =>
      /\.test\.tsx?$/.test(base) ||
      /\.spec\.ts$/.test(base) ||
      hasSegment(path, 'test') ||
      hasSegment(path, 'tests') ||
      hasSegment(path, '__tests__') ||
      /^e2e\//.test(path),
  },
  {
    // Checked before docs: `.claude/skills/security/SKILL.md` (a `.md` file)
    // is claimed here, not by docs — `.claude/**` precedes docs.
    role: 'wiring',
    test: (path, base) =>
      base === 'index.ts' ||
      base === 'index.js' ||
      base.includes('.config.') ||
      /^tsconfig.*\.json$/.test(base) ||
      /^\.eslintrc/.test(base) ||
      /^\.env/.test(base) ||
      /^docker-compose.*\.yml$/.test(base) ||
      /^\.github\//.test(path) ||
      /^\.claude\//.test(path),
  },
  {
    role: 'docs',
    test: (path, base) => /\.md$/.test(base) || /^(README|CHANGELOG|LICENSE)/.test(base) || /^docs\//.test(path),
  },
];

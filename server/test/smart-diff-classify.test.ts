/**
 * Smart Diff role classification (`modules/smart-diff/classify.ts`) — a
 * deterministic path -> role table. First matching rule in `ROLE_RULES` wins;
 * `core` is the fallback. Three entries are "contested": more than one rule
 * could plausibly claim the path, and the table pins the decision (see the
 * inline comments and Design > Data rules in the Smart Diff plan).
 */
import { describe, it, expect } from 'vitest';
import type { SmartDiffRole } from '@devdigest/shared';
import { classifyFile } from '../src/modules/smart-diff/classify.js';

describe('classifyFile', () => {
  it.each<[string, SmartDiffRole]>([
    // ---- boilerplate ----
    ['pnpm-lock.yaml', 'boilerplate'],
    ['server/pnpm-lock.yaml', 'boilerplate'],
    ['Cargo.lock', 'boilerplate'],
    ['package-lock.json', 'boilerplate'],
    ['yarn.lock', 'boilerplate'],
    ['dist/app.js', 'boilerplate'],
    ['build/x.js', 'boilerplate'],
    ['api.generated.ts', 'boilerplate'],
    ['vendor/jquery.min.js', 'boilerplate'],
    // Contested: this path also has a `__tests__/` segment (tests rule) and a
    // `.test.ts`-shaped-adjacent name, but boilerplate is checked FIRST, so a
    // snapshot under `__tests__/__snapshots__/` stays boilerplate. Decision:
    // boilerplate precedes tests.
    ['src/__tests__/__snapshots__/x.snap', 'boilerplate'],

    // `dist/`/`build/` are root-anchored on purpose: a NON-root `dist/`
    // segment (e.g. inside a client build output) does not match and falls
    // through to core. Decision: intentional, not "fixed".
    ['client/dist/app.js', 'core'],

    // ---- tests ----
    ['src/a.test.ts', 'tests'],
    ['src/a.test.tsx', 'tests'],
    ['server/test/reviews.it.test.ts', 'tests'],
    ['src/a.spec.ts', 'tests'],
    ['server/test/helpers/pg.ts', 'tests'],
    ['tests/x.py', 'tests'],
    ['src/__tests__/a.ts', 'tests'],
    ['e2e/specs/05-pr-diff.flow.json', 'tests'],
    // Contested: this basename also starts with "README" (docs rule), but
    // the path starts with `e2e/`, and tests is checked before docs.
    // Decision: keep the starter order, tests precede docs.
    ['e2e/README.md', 'tests'],

    // ---- wiring ----
    ['src/index.ts', 'wiring'],
    ['lib/index.js', 'wiring'],
    ['vitest.config.ts', 'wiring'],
    ['next.config.mjs', 'wiring'],
    ['tsconfig.json', 'wiring'],
    ['tsconfig.build.json', 'wiring'],
    ['.eslintrc.cjs', 'wiring'],
    ['.env.example', 'wiring'],
    ['docker-compose.yml', 'wiring'],
    ['.github/workflows/ci.yml', 'wiring'],
    // Contested: this basename ends in `.md` (docs rule), but the path
    // starts with `.claude/`, and wiring is checked before docs.
    // Decision: `.claude/**` precedes docs.
    ['.claude/skills/security/SKILL.md', 'wiring'],

    // ---- docs ----
    ['README.md', 'docs'],
    ['server/README.md', 'docs'],
    ['CHANGELOG.md', 'docs'],
    ['LICENSE', 'docs'],
    ['docs/plans/x.md', 'docs'],
    ['server/specs/skills.md', 'docs'],

    // ---- core (fallback; `package.json` is in no list, on purpose) ----
    ['src/modules/pulls/routes.ts', 'core'],
    ['package.json', 'core'],
    ['src/config.ts', 'core'],
    ['Makefile', 'core'],
  ])('%s -> %s', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });
});

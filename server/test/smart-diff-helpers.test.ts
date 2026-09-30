/**
 * `buildSmartDiff` (`modules/smart-diff/helpers.ts`) — pure grouping of a PR's
 * files by role, plus the `finding_lines` anchor rollup. No DB, no HTTP.
 */
import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { buildSmartDiff } from '../src/modules/smart-diff/helpers.js';
import type { SmartDiffFileInput, FindingAnchorInput } from '../src/modules/smart-diff/helpers.js';

const file = (path: string, additions: number, deletions: number): SmartDiffFileInput => ({
  path,
  additions,
  deletions,
});

const anchor = (file: string, startLine: number, dismissedAt: Date | null = null): FindingAnchorInput => ({
  file,
  startLine,
  dismissedAt,
});

describe('buildSmartDiff', () => {
  it('groups seven files across five roles in ROLE_ORDER, keeping input order inside each group', () => {
    const files = [
      file('README.md', 1, 0), // docs
      file('src/index.ts', 2, 0), // wiring
      file('src/config.ts', 3, 1), // core
      file('src/a.test.ts', 4, 2), // tests
      file('pnpm-lock.yaml', 0, 5), // boilerplate
      file('src/other.ts', 1, 1), // core
      file('docs/plan.md', 2, 0), // docs
    ];
    const result = buildSmartDiff(files, []);

    expect(result.groups.map((g) => g.role)).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
    expect(result.groups.find((g) => g.role === 'core')?.files.map((f) => f.path)).toEqual([
      'src/config.ts',
      'src/other.ts',
    ]);
    expect(result.groups.find((g) => g.role === 'docs')?.files.map((f) => f.path)).toEqual([
      'README.md',
      'docs/plan.md',
    ]);
    expect(result.split_suggestion.total_lines).toBe(1 + 2 + 4 + 6 + 5 + 2 + 2);
    expect(() => SmartDiff.parse(result)).not.toThrow();
  });

  it('omits empty groups: only core and docs files yield exactly two groups', () => {
    const files = [file('src/a.ts', 1, 0), file('docs/x.md', 1, 0)];
    const result = buildSmartDiff(files, []);
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'docs']);
  });

  it('finding_lines is sorted, unique, non-dismissed and scoped to the file', () => {
    const files = [file('src/a.ts', 1, 0)];
    const anchors = [
      anchor('src/a.ts', 12),
      anchor('src/a.ts', 5),
      anchor('src/a.ts', 12),
      anchor('src/a.ts', 7, new Date()), // dismissed: excluded
      anchor('src/other.ts', 3), // different file: excluded
    ];
    const result = buildSmartDiff(files, anchors);
    expect(result.groups[0]?.files[0]?.finding_lines).toEqual([5, 12]);
  });
});

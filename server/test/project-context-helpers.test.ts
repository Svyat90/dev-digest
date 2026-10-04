import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOTS } from '../src/modules/project-context/constants.js';
import {
  docTypeFor,
  isAttachablePath,
  isDocPath,
  orderAndDedupe,
  planSection,
  truncateToTokens,
} from '../src/modules/project-context/helpers.js';

const roots = DEFAULT_ROOTS;

describe('project-context helpers', () => {
  it('tags the innermost root and INSIGHTS.md outside roots', () => {
    expect(docTypeFor('docs/specs/x.md', roots)).toBe('specs');
    expect(docTypeFor('server/INSIGHTS.md', roots)).toBe('insights');
    expect(isDocPath('server/INSIGHTS.md', roots)).toBe(true);
    expect(isDocPath('notes/x.md', roots)).toBe(false);
  });

  it('rejects unsafe attachable paths', () => {
    for (const p of ['../../etc/passwd.md', '/abs/path.md', 'specs/notes.txt', 'specs/./a.md']) {
      expect(isAttachablePath(p, roots)).toBe(false);
    }
    expect(isAttachablePath('specs/a.md', roots)).toBe(true);
  });

  it('truncates to the token cap and flags it', () => {
    const count = (t: string) => t.length;
    const r = truncateToTokens('a'.repeat(10000), 4000, count);
    expect(r.tokens).toBeLessThanOrEqual(4000);
    expect(r.truncated).toBe(true);
    expect(truncateToTokens('abc', 4000, count).truncated).toBe(false);
  });

  it('does not split a surrogate pair', () => {
    const r = truncateToTokens('a😀b', 2, (t) => t.length);
    expect(r.text).toBe('a');
  });

  it('dedupes keeping the first position', () => {
    expect(orderAndDedupe(['a', 'b'], [['c', 'a'], ['b', 'd']])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('plans a section leaving out the overflowing doc and later ones', () => {
    const entries = [5000, 4000, 2000, 3000, 1000].map((tokens) => ({ tokens }));
    const r = planSection(entries, 12000);
    expect(r.kept.map((e) => e.tokens)).toEqual([5000, 4000, 2000]);
    expect(r.leftOut.map((e) => e.tokens)).toEqual([3000, 1000]);
  });
});

import { describe, it, expect } from 'vitest';
import { parseClosingIssueRefs } from '../src/domain/intent/closing-refs.js';

describe('parseClosingIssueRefs', () => {
  const repo = { owner: 'our', name: 'repo' };
  const text =
    'Fixes #1, closes acme/other#2, Resolved: https://github.com/acme/x/issues/3, see #4, fixes #1';

  it('returns closing-keyword refs in order, skips a bare #N and dedupes, honouring max', () => {
    expect(parseClosingIssueRefs(text, repo, 3)).toEqual([
      { owner: 'our', name: 'repo', number: 1 },
      { owner: 'acme', name: 'other', number: 2 },
      { owner: 'acme', name: 'x', number: 3 },
    ]);
    expect(parseClosingIssueRefs(text, repo, 1)).toEqual([{ owner: 'our', name: 'repo', number: 1 }]);
  });
});

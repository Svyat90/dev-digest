/**
 * Closing-keyword issue reference parser, shared by the intent and brief
 * modules. Pure: the caller owns the caps and passes the already-sliced text.
 */

export interface IssueRef {
  owner: string;
  name: string;
  number: number;
}

/**
 * Closing-keyword grammar: `Fixes #1`, `closes owner/repo#2`,
 * `Resolved: https://github.com/owner/repo/issues/3`. A bare `#123` is NOT a
 * reference. Every quantifier is bounded or over a disjoint character class,
 * so the match is linear-time.
 */
const CLOSING_REF_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?[ \t]+(?:https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d{1,9})(?!\d)|([\w.-]+)\/([\w.-]+)#(\d{1,9})(?!\d)|#(\d{1,9})(?!\d))/gi;

/** Issues closed by `text` via a closing keyword, deduped (case-insensitive), at most `max`. */
export function parseClosingIssueRefs(
  text: string,
  repo: { owner: string; name: string },
  max: number,
): IssueRef[] {
  const issues: IssueRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(CLOSING_REF_RE)) {
    if (issues.length >= max) break;
    const ref: IssueRef | null = m[3]
      ? { owner: m[1]!, name: m[2]!, number: Number(m[3]) }
      : m[6]
        ? { owner: m[4]!, name: m[5]!, number: Number(m[6]) }
        : m[7]
          ? { owner: repo.owner, name: repo.name, number: Number(m[7]) }
          : null;
    if (!ref) continue;
    const key = `${ref.owner}/${ref.name}#${ref.number}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(ref);
  }
  return issues;
}

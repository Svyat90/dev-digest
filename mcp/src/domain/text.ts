/** Cut `s` to at most `n` characters, marking the cut with an ellipsis. */
export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1))}…`;
}

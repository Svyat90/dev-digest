import type { BlastRadiusResponse, DownstreamImpact } from '@devdigest/shared';
import type { BlastFacadeResult, BlastLimits, IndexStateLike } from './types.js';

/** Order-preserving de-duplicated union. */
function union(lists: string[][]): string[] {
  const seen = new Set<string>();
  for (const list of lists) for (const v of list) seen.add(v);
  return [...seen];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * BR7 — deterministic one-line summary, e.g. `2 symbols · 14 callers · 3 endpoints · 1 cron`.
 * `endpoints` / `crons` are unique across groups. Coupled with the client's `blastCounts`.
 */
export function buildSummary(symbolCount: number, downstream: DownstreamImpact[]): string {
  const callers = downstream.reduce((n, g) => n + g.callers.length, 0);
  const endpoints = new Set(downstream.flatMap((g) => g.endpoints_affected)).size;
  const crons = new Set(downstream.flatMap((g) => g.crons_affected)).size;
  return [
    plural(symbolCount, 'symbol', 'symbols'),
    plural(callers, 'caller', 'callers'),
    plural(endpoints, 'endpoint', 'endpoints'),
    plural(crons, 'cron', 'crons'),
  ].join(' · ');
}

/** Facade result + index state → the `BlastRadiusResponse` contract (BR2–BR8, BR13). Pure. */
export function toBlastRadius(
  result: BlastFacadeResult,
  state: IndexStateLike,
  limits: BlastLimits,
): BlastRadiusResponse {
  // BR3: files where each symbol is declared — a caller there is not "downstream".
  const declaredIn = new Map<string, Set<string>>();
  for (const s of result.changedSymbols) {
    const files = declaredIn.get(s.name);
    if (files) files.add(s.file);
    else declaredIn.set(s.name, new Set([s.file]));
  }

  // BR2: group by the changed symbol each caller reaches.
  const bySymbol = new Map<string, BlastFacadeResult['callers']>();
  for (const c of result.callers) {
    if (declaredIn.get(c.viaSymbol)?.has(c.file)) continue;
    const arr = bySymbol.get(c.viaSymbol);
    if (arr) arr.push(c);
    else bySymbol.set(c.viaSymbol, [c]);
  }

  const groups = [...bySymbol].map(([symbol, callers]) => {
    const files = callers.map((c) => c.file);
    // BR4: attribute endpoints/crons from the group's own caller files.
    const facts = (pick: 'endpoints' | 'crons') =>
      union(files.map((f) => result.factsByFile?.[f]?.[pick] ?? []));
    return {
      maxRank: Math.max(...callers.map((c) => c.rank)),
      impact: {
        symbol,
        callers: callers.map((c) => ({ name: c.symbol, file: c.file, line: c.line })),
        endpoints_affected: facts('endpoints'),
        crons_affected: facts('crons'),
      } satisfies DownstreamImpact,
    };
  });
  // BR5: callers keep the facade order; groups by max rank DESC, then symbol ASC.
  groups.sort((a, b) => b.maxRank - a.maxRank || a.impact.symbol.localeCompare(b.impact.symbol));
  const downstream = groups.map((g) => g.impact);

  // BR8: honest degradation; data is always carried.
  let degraded = false;
  let reason: BlastRadiusResponse['reason'] = null;
  if (result.degraded) {
    degraded = true;
    reason = result.reason ?? 'no_data';
  } else if (state.status === 'partial') {
    degraded = true;
    reason = 'index_partial';
  }

  return {
    changed_symbols: result.changedSymbols.map((s) => ({ name: s.name, file: s.file, kind: s.kind })),
    downstream,
    summary: buildSummary(result.changedSymbols.length, downstream),
    degraded,
    reason,
    index_status: state.status,
    index_sha: state.lastIndexedSha || null, // BR13
    limits: { max_callers_per_symbol: limits.maxCallersPerSymbol }, // BR6
  };
}

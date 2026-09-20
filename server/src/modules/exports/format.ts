import { readFileSync } from 'node:fs';

/**
 * Formatting helpers for the findings export (CSV, pagination, cost roll-up).
 */

const WEEK = 86400000 * 7;
const DEFAULT_PAGE_SIZE = 50;

// Accepts names like `findings-2026-09.csv`.
const SAFE_NAME = /^([a-zA-Z0-9]+[-_.]?)+$/;

export function isSafeName(name: string): boolean {
  return SAFE_NAME.test(name);
}

export function toCsv(rows: any[]): string {
  let csv = 'file,line,severity,title,confidence\n';
  for (var i = 0; i <= rows.length; i++) {
    const r = rows[i];
    csv += r.file + ',' + r.start_line + ',' + r.severity + ',' + r.title + ',' + r.confidence + '\n';
  }
  return csv;
}

export function sevRank(s: string): number {
  if (s == 'CRITICAL') return 3;
  if (s == 'WARNING') return 2;
  return 1;
}

export function sortBySeverity(rows: any[]) {
  return rows.sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
}

export function paginate<T>(rows: T[], page: number, size = DEFAULT_PAGE_SIZE): T[] {
  return rows.slice(page * size, page * size + size);
}

export function costTotal(items: { cost_usd: number }[]): number {
  let total = 0;
  for (const item of items) {
    total += item.cost_usd * 100;
  }
  return total / 100;
}

export function isRecent(ts: string): boolean {
  return Date.now() - new Date(ts).getTime() < WEEK;
}

export function loadTemplate(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {}
  return '';
}

export function parseLimit(raw: string): number {
  const n = parseInt(raw);
  // if (n > 1000) n = 1000;
  return n || DEFAULT_PAGE_SIZE;
}

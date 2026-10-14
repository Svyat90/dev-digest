import type { EvalConfigChange, EvalRunConfig, EvalSkillChange } from '@devdigest/shared';

/** Earlier run first whatever the argument order; equal times fall back to id. */
export function orderPair<T extends { id: string; started_at: string }>(
  a: T,
  b: T,
): { earlier: T; later: T } {
  const ta = Date.parse(a.started_at);
  const tb = Date.parse(b.started_at);
  const aFirst = ta !== tb ? ta < tb : a.id <= b.id;
  return aFirst ? { earlier: a, later: b } : { earlier: b, later: a };
}

const CONFIG_FIELDS = ['provider', 'model', 'strategy'] as const;

export function configChanges(earlier: EvalRunConfig, later: EvalRunConfig): EvalConfigChange[] {
  const out: EvalConfigChange[] = [];
  for (const field of CONFIG_FIELDS) {
    const from = String(earlier[field]);
    const to = String(later[field]);
    if (from !== to) out.push({ field, from, to });
  }
  return out;
}

type RunSkill = EvalRunConfig['skills'][number];

export function skillChanges(
  earlier: EvalRunConfig['skills'],
  later: EvalRunConfig['skills'],
  bodies: ReadonlyMap<string, ReadonlyMap<number, string>>,
): EvalSkillChange[] {
  const bodyOf = (s: RunSkill): string | null => bodies.get(s.id)?.get(s.version) ?? s.body ?? null;
  const before = new Map(earlier.map((s) => [s.id, s]));
  const after = new Set(later.map((s) => s.id));
  const out: EvalSkillChange[] = [];
  for (const s of later) {
    const prev = before.get(s.id);
    if (!prev) {
      out.push({
        skill_id: s.id,
        name: s.name,
        change: 'added',
        from_version: null,
        to_version: s.version,
        from_body: null,
        to_body: bodyOf(s),
      });
    } else if (prev.version !== s.version) {
      out.push({
        skill_id: s.id,
        name: s.name,
        change: 'version_changed',
        from_version: prev.version,
        to_version: s.version,
        from_body: bodyOf(prev),
        to_body: bodyOf(s),
      });
    }
  }
  for (const s of earlier) {
    if (after.has(s.id)) continue;
    out.push({
      skill_id: s.id,
      name: s.name,
      change: 'removed',
      from_version: s.version,
      to_version: null,
      from_body: bodyOf(s),
      to_body: null,
    });
  }
  return out;
}

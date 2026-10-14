import type { EvalRunStatus, SkillEvalAgent } from "@devdigest/shared";
import { runAllBlocker, type RunAllBlocker } from "@/components/eval-suite";

/** Why a skill run cannot start: no cases, or one already running (SPEC-06 AC21). */
export function skillRunBlocker(
  cases: readonly unknown[],
  runs: readonly { status: EvalRunStatus }[],
): RunAllBlocker | null {
  return runAllBlocker(cases, runs);
}

/** True when the skill has no usable remembered agent (none yet, or a deleted one). */
export function needsAgent(agent: SkillEvalAgent | null | undefined): boolean {
  return !agent?.agent;
}

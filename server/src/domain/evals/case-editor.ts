/**
 * Case editor rules (SPEC-06): what counts as a content change, the expected
 * output of a finding-made case, the editor's last-run pick and the skill a
 * skill eval run turns on.
 *
 * Pure on purpose (`domain-is-pure`): every input is a value the caller
 * loaded, so none of these can reach a model, a clock or a database.
 */
import type {
  EvalCaseCheck,
  EvalCaseDetail,
  EvalCaseInputMeta,
  EvalCaseLastRun,
  EvalCaseProvenance,
  EvalExpectation,
  EvalExpectationType,
  EvalExpectedOutput,
  EvalRunConfig,
} from '@devdigest/shared';

/** The content fields of a case revision; the name and `inputFiles` are not content. */
export interface RevisionContentLike {
  inputDiff: string;
  inputMeta: EvalCaseInputMeta;
  expectationType: EvalExpectationType;
  expectation: EvalExpectation;
  expectedOutput: EvalExpectedOutput | null;
}

/** JSON with object keys sorted, so key order never reads as a change. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** True when a save changes the case's content and so needs a new revision (AC11, EC13). */
export function revisionContentChanged(
  prev: RevisionContentLike,
  next: RevisionContentLike,
): boolean {
  return (
    prev.inputDiff !== next.inputDiff ||
    prev.inputMeta.pr_title !== next.inputMeta.pr_title ||
    prev.inputMeta.pr_description !== next.inputMeta.pr_description ||
    prev.expectationType !== next.expectationType ||
    prev.expectation.file !== next.expectation.file ||
    prev.expectation.start_line !== next.expectation.start_line ||
    prev.expectation.end_line !== next.expectation.end_line ||
    canonicalJson(prev.expectedOutput) !== canonicalJson(next.expectedOutput)
  );
}

/** The expected output shown for a finding-made case, which stores none (A4). */
export function expectedOutputFromProvenance(
  type: EvalExpectationType,
  expectation: EvalExpectation,
  provenance: EvalCaseProvenance,
): EvalCaseDetail['expected_output'] {
  if (type === 'must_not_flag') return [];
  return [
    {
      severity: provenance.severity,
      category: provenance.category,
      title: provenance.title,
      file: expectation.file,
      start_line: expectation.start_line,
      end_line: expectation.end_line,
    },
  ];
}

/** A finished check as a last-run candidate; a running check is none. */
function checkAsLastRun(check: EvalCaseCheck): EvalCaseLastRun | null {
  if (check.status === 'running' || check.finished_at === null) return null;
  return {
    source: 'check',
    status: check.status,
    expected: check.expected,
    got: check.got,
    error: check.error,
    duration_ms: check.duration_ms,
    cost_usd: check.cost_usd,
    finished_at: check.finished_at,
  };
}

/** The editor's last-run strip: the newer of a finished check and a run result (A3). */
export function pickLastRun(
  check: EvalCaseCheck | null,
  runResult: EvalCaseLastRun | null,
): EvalCaseLastRun | null {
  const fromCheck = check ? checkAsLastRun(check) : null;
  if (!fromCheck) return runResult;
  if (!runResult) return fromCheck;
  return Date.parse(fromCheck.finished_at) >= Date.parse(runResult.finished_at)
    ? fromCheck
    : runResult;
}

/**
 * The run config with the measured skill on for this run only (AC19): at its
 * linked position when linked, else after the others. `agent_skills` is never
 * touched; the input config is not mutated.
 */
export function withSkillForRun(
  config: EvalRunConfig,
  skill: { id: string; name: string; description: string; body: string; version: number },
): EvalRunConfig {
  const linked = config.skills.find((s) => s.id === skill.id);
  const order = linked
    ? linked.order
    : config.skills.reduce((max, s) => Math.max(max, s.order + 1), 0);
  const entry: EvalRunConfig['skills'][number] = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    order,
    link_enabled: true,
    skill_enabled: true,
    body: skill.body,
  };
  const skills = linked
    ? config.skills.map((s) => (s.id === skill.id ? entry : { ...s }))
    : [...config.skills.map((s) => ({ ...s })), entry];
  return { ...config, skills };
}

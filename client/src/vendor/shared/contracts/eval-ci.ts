import { z } from 'zod';
import { Verdict, Finding, Severity, FindingCategory } from './findings.js';
import { EvalRun, EvalOwnerKind, Conformance, Provider, ReviewStrategy } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

// --- Eval pipeline (SPEC-04): cases from findings, runs over a case set -----

export const EvalExpectationType = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationType = z.infer<typeof EvalExpectationType>;

/** Where the finding sat: the reviewed file and its inclusive line range. */
export const EvalExpectation = z.object({
  file: z.string().min(1),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

export const EvalCaseInputMeta = z.object({
  pr_title: z.string(),
  pr_description: z.string().max(4000),
});
export type EvalCaseInputMeta = z.infer<typeof EvalCaseInputMeta>;

export const EvalDecision = z.enum(['accepted', 'dismissed']);
export type EvalDecision = z.infer<typeof EvalDecision>;

/** Where a case came from: the finding, its PR and the decision on it. */
export const EvalCaseProvenance = z.object({
  finding_id: z.string(),
  review_id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int(),
  repo_id: z.string(),
  repo_full_name: z.string(),
  decision: EvalDecision,
  decided_at: z.string(),
  agent_version: z.number().int().nullable(),
  severity: Severity,
  category: FindingCategory,
  title: z.string(),
});
export type EvalCaseProvenance = z.infer<typeof EvalCaseProvenance>;

/** An agent's eval case; content fields come from its current (highest) revision. */
export const AgentEvalCase = z.object({
  id: z.string(),
  agent_id: z.string(),
  name: z.string(),
  revision_id: z.string(),
  revision: z.number().int().positive(),
  expectation_type: EvalExpectationType,
  expectation: EvalExpectation,
  input_file: z.string(),
  input_meta: EvalCaseInputMeta,
  provenance: EvalCaseProvenance,
  created_at: z.string(),
});
export type AgentEvalCase = z.infer<typeof AgentEvalCase>;

export const EvalCaseResultStatus = z.enum(['passed', 'failed', 'errored']);
export type EvalCaseResultStatus = z.infer<typeof EvalCaseResultStatus>;

export const EvalCaseLatestResult = z.object({
  eval_run_id: z.string(),
  case_revision_id: z.string().nullable(),
  status: EvalCaseResultStatus,
  expected: z.number().int(),
  got: z.number().int().nullable(),
  error: z.string().nullable(),
});
export type EvalCaseLatestResult = z.infer<typeof EvalCaseLatestResult>;

/** A case with the outcome of its latest run (null = never run). */
export const AgentEvalCaseListItem = AgentEvalCase.extend({
  latest_result: EvalCaseLatestResult.nullable(),
});
export type AgentEvalCaseListItem = z.infer<typeof AgentEvalCaseListItem>;

/** One linked skill as the run saw it; `body` only when the run sent it. */
export const EvalRunSkill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.number().int(),
  order: z.number().int(),
  link_enabled: z.boolean(),
  skill_enabled: z.boolean(),
  body: z.string().nullable(),
});
export type EvalRunSkill = z.infer<typeof EvalRunSkill>;

/** The agent configuration a run used; `skills` are in link order. */
export const EvalRunConfig = z.object({
  agent_version: z.number().int(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  strategy: ReviewStrategy,
  skills: z.array(EvalRunSkill),
});
export type EvalRunConfig = z.infer<typeof EvalRunConfig>;

/** One case a run covered, at the revision it was run over. */
export const EvalRunCaseRef = z.object({
  case_id: z.string(),
  revision_id: z.string(),
  revision: z.number().int().positive(),
});
export type EvalRunCaseRef = z.infer<typeof EvalRunCaseRef>;

export const EvalRunStatus = z.enum(['running', 'completed', 'failed']);
export type EvalRunStatus = z.infer<typeof EvalRunStatus>;

/** One eval run: the agent over all of its cases. */
export const AgentEvalRunSummary = z.object({
  id: z.string(),
  agent_id: z.string(),
  status: EvalRunStatus,
  started_at: z.string(),
  finished_at: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  agent_version: z.number().int(),
  cases_total: z.number().int(),
  cases_done: z.number().int(),
  cases_scored: z.number().int(),
  cases_passed: z.number().int(),
  recall: z.number().min(0).max(1).nullable(),
  precision: z.number().min(0).max(1).nullable(),
  citation_accuracy: z.number().min(0).max(1).nullable(),
  cost_usd: z.number().nullable(),
  error: z.string().nullable(),
});
export type AgentEvalRunSummary = z.infer<typeof AgentEvalRunSummary>;

/** A persisted per-case eval result (one case of one eval run), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  // null once the case was deleted; the result itself stays (AC9)
  case_id: z.string().nullable(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  eval_run_id: z.string(),
  case_revision_id: z.string().nullable(),
  status: EvalCaseResultStatus,
  error: z.string().nullable(),
  expectation_type: EvalExpectationType,
  expectation: EvalExpectation,
  findings_returned: z.number().int().nullable(),
  findings_grounded: z.number().int().nullable(),
  findings_matching: z.number().int().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

export const AgentEvalRunDetail = AgentEvalRunSummary.extend({
  config: EvalRunConfig,
  cases: z.array(EvalRunCaseRef),
  results: z.array(EvalRunRecord),
});
export type AgentEvalRunDetail = z.infer<typeof AgentEvalRunDetail>;

export const StartEvalRunResponse = z.object({ run_id: z.string() });
export type StartEvalRunResponse = z.infer<typeof StartEvalRunResponse>;

export const CreateEvalCaseResponse = z.object({
  case: AgentEvalCase,
  created: z.boolean(),
});
export type CreateEvalCaseResponse = z.infer<typeof CreateEvalCaseResponse>;

export const EvalErrorCode = z.enum([
  'eval_case_undecided',
  'eval_case_no_agent',
  'eval_case_agent_missing',
  'eval_case_no_diff',
  'eval_case_diff_too_large',
  'eval_case_lines_outside_diff',
  'no_eval_cases',
  'eval_run_in_progress',
]);
export type EvalErrorCode = z.infer<typeof EvalErrorCode>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalRunRecord),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;

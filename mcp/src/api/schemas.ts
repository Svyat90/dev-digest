import { z } from 'zod';

// Consumer-side projections: only the fields mcp reads. Objects are non-strict
// (unknown keys stripped). The canonical contracts live in
// server/src/vendor/shared; when one changes, check the projection here.

// canonical: server/src/vendor/shared/contracts/knowledge.ts Agent
export const AgentLite = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  model: z.string(),
  enabled: z.boolean(),
});
export type AgentLite = z.infer<typeof AgentLite>;
export const AgentList = z.array(AgentLite);

// canonical: server/src/vendor/shared/contracts/platform.ts Repo
export const RepoLite = z.object({ id: z.string(), full_name: z.string() });
export type RepoLite = z.infer<typeof RepoLite>;
export const RepoList = z.array(RepoLite);

// canonical: server/src/modules/repos/routes.ts GET /repos/lookup
export const LookupResult = z.object({
  repo: z.object({ id: z.string(), full_name: z.string() }),
  pull: z.object({ id: z.string(), number: z.number().int() }).nullable(),
});
export type LookupResult = z.infer<typeof LookupResult>;

// canonical: server/src/modules/reviews/repository/run.repo.ts RunState (GET /runs/:id)
// run_id is checked as a uuid because tools interpolate it into `next`.
export const RunState = z.object({
  run_id: z.string().uuid(),
  pr_id: z.string().nullable().optional(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  status: z.string().nullable(), // running | done | failed | cancelled
  error: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  score: z.number().int().nullable(),
  blockers: z.number().int().nullable(),
  ran_at: z.string().nullable(),
});
export type RunState = z.infer<typeof RunState>;
export const RunStateList = z.array(RunState);

// canonical: server/src/modules/reviews/repository/run.repo.ts activeRunsForPull
export const ActiveRun = z.object({
  run_id: z.string().uuid(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  ran_at: z.string().nullable(),
});
export type ActiveRun = z.infer<typeof ActiveRun>;
export const ActiveRunList = z.array(ActiveRun);

// canonical: server/src/vendor/shared/contracts/review-api.ts ReviewRunResponse
export const ReviewRunResponseLite = z.object({
  pr_id: z.string(),
  runs: z.array(z.object({ run_id: z.string().uuid(), agent_id: z.string(), agent_name: z.string() })),
});
export type ReviewRunResponseLite = z.infer<typeof ReviewRunResponseLite>;

// canonical: server/src/vendor/shared/contracts/review-api.ts FindingRecord
export const FindingLite = z.object({
  id: z.string(),
  severity: z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']),
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  rationale: z.string(),
  suggestion: z.string().nullish(),
});
export type FindingLite = z.infer<typeof FindingLite>;

// canonical: server/src/vendor/shared/contracts/review-api.ts ReviewRecord
export const ReviewLite = z.object({
  id: z.string(),
  run_id: z.string().nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  findings: z.array(FindingLite),
});
export type ReviewLite = z.infer<typeof ReviewLite>;
export const ReviewLiteList = z.array(ReviewLite);

// canonical: server/src/vendor/shared/contracts/review-api.ts BlastRadiusResponse
export const BlastRadiusLite = z.object({
  changed_symbols: z.array(z.object({ name: z.string(), file: z.string(), kind: z.string() })),
  downstream: z.array(
    z.object({
      symbol: z.string(),
      callers: z.array(z.object({ name: z.string(), file: z.string(), line: z.number().int() })),
      endpoints_affected: z.array(z.string()),
      crons_affected: z.array(z.string()),
    }),
  ),
  summary: z.string(),
  degraded: z.boolean(),
  reason: z.string().nullable(),
  index_status: z.string(),
});
export type BlastRadiusLite = z.infer<typeof BlastRadiusLite>;

// canonical: server/src/vendor/shared/contracts/knowledge.ts ConventionList
export const ConventionListLite = z.object({
  scan: z.object({ status: z.string(), created_at: z.string() }).nullable(),
  repo: z.object({ full_name: z.string() }),
  candidates: z.array(
    z.object({
      id: z.string(),
      category: z.string().nullish(),
      rule: z.string(),
      evidence_path: z.string(),
      evidence_start_line: z.number().int(),
      evidence_end_line: z.number().int(),
      status: z.string(),
    }),
  ),
});
export type ConventionListLite = z.infer<typeof ConventionListLite>;

// canonical: server/src/vendor/shared/contracts/platform.ts ApiErrorBody
export const ApiErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

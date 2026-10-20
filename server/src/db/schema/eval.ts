import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  EvalCaseInputMeta,
  EvalCaseProvenance,
  EvalExpectation,
  EvalExpectedOutput,
  EvalRunCaseRef,
  EvalRunConfig,
} from '@devdigest/shared';
import { workspaces } from './core';
import { agents } from './agents';
import { skills } from './skills';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

// A case keeps identity only; its content (frozen diff, files, meta, expectation)
// lives in append-only `eval_case_revisions`.
export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    // Nullable: future skill-owned cases have no agent.
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    // Set on skill-owned cases (`owner_kind = 'skill'`, `owner_id = skill_id`).
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    notes: text('notes'),
    // No FK: the case outlives the finding it was made from.
    sourceFindingId: uuid('source_finding_id'),
    provenance: jsonb('provenance').$type<EvalCaseProvenance>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    wsAgentIdx: index('eval_cases_ws_agent_idx').on(t.workspaceId, t.agentId),
    wsSkillIdx: index('eval_cases_ws_skill_idx').on(t.workspaceId, t.skillId),
    // UNIQUE with NULLs distinct on purpose: manual cases have no source finding,
    // so only finding-made cases are limited to one per (agent, finding).
    agentFindingUq: uniqueIndex('eval_cases_agent_finding_uq').on(t.agentId, t.sourceFindingId),
    // SPEC-04 AC5 / SPEC-06 AC8: no two cases of one set share a name. FULL index
    // (all four columns are NOT NULL), so it can also be an ON CONFLICT arbiter.
    ownerNameUq: uniqueIndex('eval_cases_owner_name_uq').on(
      t.workspaceId,
      t.ownerKind,
      t.ownerId,
      t.name,
    ),
  }),
);

// Append-only: no code updates or deletes a row (only the FK cascade removes them).
// A case's "current" revision is its highest `revision`.
export const evalCaseRevisions = pgTable(
  'eval_case_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    inputDiff: text('input_diff').notNull(),
    inputFiles: jsonb('input_files').$type<string[]>().notNull(),
    inputMeta: jsonb('input_meta').$type<EvalCaseInputMeta>().notNull(),
    expectationType: text('expectation_type', { enum: ['must_find', 'must_not_flag'] }).notNull(),
    expectation: jsonb('expectation').$type<EvalExpectation>().notNull(),
    // Null on finding-made revisions (SPEC-06 A4); manual cases store their expected finding list.
    expectedOutput: jsonb('expected_output').$type<EvalExpectedOutput>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    caseRevUq: uniqueIndex('eval_case_revisions_case_rev_uq').on(t.caseId, t.revision),
    wsIdx: index('eval_case_revisions_ws_idx').on(t.workspaceId),
  }),
);

// One run over all cases of an owner: an agent's own run (`agent_id` set), or a
// skill run through a via agent (`agent_id` NULL, `skill_id` set). `eval_runs`
// holds its per-case results.
export const evalSuiteRuns = pgTable(
  'eval_suite_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Null on skill runs, so they never reach agent views (SPEC-06).
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'cascade' }),
    skillVersion: integer('skill_version'),
    // SET NULL: a skill run outlives its via agent and keeps `agent_name` (SPEC-06 AC22).
    viaAgentId: uuid('via_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    agentName: text('agent_name'),
    status: text('status', { enum: ['running', 'completed', 'failed'] })
      .notNull()
      .default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    agentVersion: integer('agent_version').notNull(),
    config: jsonb('config').$type<EvalRunConfig>().notNull(),
    // Covered case + revision list; never nulled, so a past run still names a deleted case.
    cases: jsonb('cases').$type<EvalRunCaseRef[]>().notNull(),
    casesTotal: integer('cases_total').notNull(),
    casesDone: integer('cases_done').notNull().default(0),
    casesScored: integer('cases_scored').notNull().default(0),
    casesPassed: integer('cases_passed').notNull().default(0),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    // null = unknown cost, 0 = free.
    costUsd: doublePrecision('cost_usd'),
    error: text('error'),
  },
  (t) => ({
    agentStartedIdx: index('eval_suite_runs_agent_started_idx').on(t.agentId, t.startedAt),
    // At most one running run per agent; the insert conflict is the refusal.
    oneRunningUq: uniqueIndex('eval_suite_runs_one_running_uq')
      .on(t.agentId)
      .where(sql`status = 'running'`),
    wsIdx: index('eval_suite_runs_ws_idx').on(t.workspaceId),
    skillStartedIdx: index('eval_suite_runs_skill_started_idx').on(t.skillId, t.startedAt),
    // At most one running run per skill; skill runs have agent_id NULL, so they
    // never collide with the via agent's own run.
    oneRunningSkillUq: uniqueIndex('eval_suite_runs_one_running_skill_uq')
      .on(t.skillId)
      .where(sql`status = 'running'`),
    viaAgentIdx: index('eval_suite_runs_via_agent_idx').on(t.viaAgentId),
  }),
);

// Per-case results of a suite run (one row per case).
export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    suiteRunId: uuid('suite_run_id')
      .notNull()
      .references(() => evalSuiteRuns.id, { onDelete: 'cascade' }),
    // Nullable + SET NULL: a deleted case keeps its past results (AC9).
    caseId: uuid('case_id').references(() => evalCases.id, { onDelete: 'set null' }),
    caseRevisionId: uuid('case_revision_id').references(() => evalCaseRevisions.id, {
      onDelete: 'set null',
    }),
    caseName: text('case_name').notNull(),
    status: text('status', { enum: ['passed', 'failed', 'errored'] }).notNull(),
    error: text('error'),
    expectationType: text('expectation_type', { enum: ['must_find', 'must_not_flag'] }).notNull(),
    expectation: jsonb('expectation').$type<EvalExpectation>().notNull(),
    findingsReturned: integer('findings_returned'),
    findingsGrounded: integer('findings_grounded'),
    findingsMatching: integer('findings_matching'),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    actualOutput: jsonb('actual_output'),
    pass: boolean('pass'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => ({
    suiteIdx: index('eval_runs_suite_idx').on(t.suiteRunId),
    caseIdx: index('eval_runs_case_idx').on(t.caseId),
    caseRevisionIdx: index('eval_runs_case_revision_idx').on(t.caseRevisionId),
  }),
);

// Single-case results (SPEC-06): a scratch check that never enters run history.
// One row per revision (newest by upsert), at most one running per case.
export const evalCaseChecks = pgTable(
  'eval_case_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    caseRevisionId: uuid('case_revision_id')
      .notNull()
      .references(() => evalCaseRevisions.id, { onDelete: 'cascade' }),
    // Enum hint only (no CHECK constraint); the contract enum guards the writes.
    status: text('status', { enum: ['running', 'passed', 'failed', 'errored'] }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    expected: integer('expected').notNull(),
    got: integer('got'),
    error: text('error'),
    // null = unknown cost, 0 = free.
    costUsd: doublePrecision('cost_usd'),
    findingsReturned: integer('findings_returned'),
    findingsGrounded: integer('findings_grounded'),
    findingsMatching: integer('findings_matching'),
  },
  (t) => ({
    // Full index: the upsert target (a partial index cannot be one); also the FK index.
    revisionUq: uniqueIndex('eval_case_checks_revision_uq').on(t.caseRevisionId),
    caseIdx: index('eval_case_checks_case_idx').on(t.caseId),
    oneRunningUq: uniqueIndex('eval_case_checks_one_running_uq')
      .on(t.caseId)
      .where(sql`status = 'running'`),
    wsIdx: index('eval_case_checks_ws_idx').on(t.workspaceId),
  }),
);

// The agent a skill's evals run through, remembered per skill. `agent_name` is
// kept after the agent is deleted, for "<name> no longer exists".
export const skillEvalAgents = pgTable(
  'skill_eval_agents',
  {
    skillId: uuid('skill_id')
      .primaryKey()
      .references(() => skills.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    agentName: text('agent_name').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    agentIdx: index('skill_eval_agents_agent_idx').on(t.agentId),
    wsIdx: index('skill_eval_agents_ws_idx').on(t.workspaceId),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});

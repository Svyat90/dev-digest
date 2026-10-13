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
  EvalRunCaseRef,
  EvalRunConfig,
} from '@devdigest/shared';
import { workspaces } from './core';
import { agents } from './agents';
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
    name: text('name').notNull(),
    notes: text('notes'),
    // No FK: the case outlives the finding it was made from.
    sourceFindingId: uuid('source_finding_id'),
    provenance: jsonb('provenance').$type<EvalCaseProvenance>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    wsAgentIdx: index('eval_cases_ws_agent_idx').on(t.workspaceId, t.agentId),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    caseRevUq: uniqueIndex('eval_case_revisions_case_rev_uq').on(t.caseId, t.revision),
    wsIdx: index('eval_case_revisions_ws_idx').on(t.workspaceId),
  }),
);

// One run of an agent over all of its cases. `eval_runs` holds its per-case results.
export const evalSuiteRuns = pgTable(
  'eval_suite_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
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

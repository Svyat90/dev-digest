import { pgTable, uuid, text, integer, primaryKey, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { agents } from './agents';
import { skills } from './skills';

// ============================================================ Project context attachments
// Repository-relative document paths attached to an agent or a skill. Paths only —
// the document text is read from the clone at run time, never stored.

export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    position: integer('position').notNull(),
    createdAt: now(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.path] }),
    usageIdx: index('agent_context_docs_workspace_path_idx').on(t.workspaceId, t.path),
  }),
);

export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    position: integer('position').notNull(),
    createdAt: now(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.path] }),
    usageIdx: index('skill_context_docs_workspace_path_idx').on(t.workspaceId, t.path),
  }),
);

import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { workspaces } from './core';

export const labels = pgTable(
  'labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex('labels_ws_name_uq').on(t.workspaceId, t.name),
  }),
);

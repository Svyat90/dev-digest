import { z } from 'zod';

/**
 * Project context: markdown documents of a repository that authors attach to
 * agents and skills. Only paths are stored; text is read from the clone at
 * listing / run time.
 */

export const ContextDoc = z.object({
  path: z.string(),
  type: z.string(),
  /** null when the file could not be read. */
  tokens: z.number().int().nullable(),
  truncated: z.boolean(),
});
export type ContextDoc = z.infer<typeof ContextDoc>;

export const ContextDocList = z.object({
  repo: z.object({ id: z.string(), full_name: z.string() }),
  status: z.enum(['ok', 'not_cloned']),
  roots: z.array(z.string()),
  documents: z.array(ContextDoc),
  total: z.number().int(),
});
export type ContextDocList = z.infer<typeof ContextDocList>;

export const ContextDocContent = z.object({
  path: z.string(),
  content: z.string(),
});
export type ContextDocContent = z.infer<typeof ContextDocContent>;

export const AttachedDoc = z.object({
  path: z.string(),
  type: z.string().nullable(),
  found: z.boolean(),
  tokens: z.number().int().nullable(),
  truncated: z.boolean(),
});
export type AttachedDoc = z.infer<typeof AttachedDoc>;

export const InheritedDoc = AttachedDoc.extend({
  skill_id: z.string(),
  skill_name: z.string(),
});
export type InheritedDoc = z.infer<typeof InheritedDoc>;

const ContextRepoRef = z.object({
  id: z.string(),
  full_name: z.string(),
  cloned: z.boolean(),
});

export const AgentContextDocs = z.object({
  repo: ContextRepoRef,
  own: z.array(AttachedDoc),
  inherited: z.array(InheritedDoc),
  total_tokens: z.number().int(),
  cap_tokens: z.number().int(),
  left_out: z.array(z.string()),
});
export type AgentContextDocs = z.infer<typeof AgentContextDocs>;

export const SkillContextDocs = z.object({
  repo: ContextRepoRef,
  own: z.array(AttachedDoc),
  total_tokens: z.number().int(),
});
export type SkillContextDocs = z.infer<typeof SkillContextDocs>;

export const PutContextDocsBody = z.object({
  paths: z.array(z.string().min(1).max(500)).max(200),
});
export type PutContextDocsBody = z.infer<typeof PutContextDocsBody>;

export const AttachContextDocBody = z.object({
  path: z.string().min(1).max(500),
});
export type AttachContextDocBody = z.infer<typeof AttachContextDocBody>;

export const ContextDocPaths = z.object({
  paths: z.array(z.string()),
});
export type ContextDocPaths = z.infer<typeof ContextDocPaths>;

export const ContextDocUsage = z.object({
  agents: z.array(z.object({ id: z.string(), name: z.string() })),
  skills: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type ContextDocUsage = z.infer<typeof ContextDocUsage>;

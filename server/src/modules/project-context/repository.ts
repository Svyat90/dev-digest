import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Project-context data access. Owns `agent_context_docs` / `skill_context_docs`
 * (paths only, never text) plus the tenancy lookups the service needs on
 * `agents`, `skills` and `repos`. Every method is workspace-scoped; a foreign
 * id looks exactly like a missing one (`undefined`).
 */

export interface RepoLookup {
  id: string;
  owner: string;
  name: string;
  fullName: string;
}

export interface OwnerLookup {
  id: string;
  name: string;
}

export interface SkillDocRow {
  skillId: string;
  path: string;
}

export class ProjectContextRepository {
  constructor(private db: Db) {}

  async repoInWorkspace(workspaceId: string, repoId: string): Promise<RepoLookup | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async agentInWorkspace(workspaceId: string, agentId: string): Promise<OwnerLookup | undefined> {
    const [row] = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)));
    return row;
  }

  async skillInWorkspace(workspaceId: string, skillId: string): Promise<OwnerLookup | undefined> {
    const [row] = await this.db
      .select({ id: t.skills.id, name: t.skills.name })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)));
    return row;
  }

  /** An agent's attached paths in attachment order. */
  async agentDocPaths(workspaceId: string, agentId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .where(
        and(
          eq(t.agentContextDocs.workspaceId, workspaceId),
          eq(t.agentContextDocs.agentId, agentId),
        ),
      )
      .orderBy(asc(t.agentContextDocs.position));
    return rows.map((r) => r.path);
  }

  /** Attached paths of several skills, each skill's rows in attachment order. */
  async skillDocPathsFor(workspaceId: string, skillIds: string[]): Promise<SkillDocRow[]> {
    if (skillIds.length === 0) return [];
    return this.db
      .select({ skillId: t.skillContextDocs.skillId, path: t.skillContextDocs.path })
      .from(t.skillContextDocs)
      .where(
        and(
          eq(t.skillContextDocs.workspaceId, workspaceId),
          inArray(t.skillContextDocs.skillId, skillIds),
        ),
      )
      .orderBy(asc(t.skillContextDocs.position));
  }

  /** Agents and skills of the workspace that have `path` attached. */
  async usage(
    workspaceId: string,
    path: string,
  ): Promise<{ agents: OwnerLookup[]; skills: OwnerLookup[] }> {
    const agents = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agentContextDocs)
      .innerJoin(t.agents, eq(t.agentContextDocs.agentId, t.agents.id))
      .where(
        and(eq(t.agentContextDocs.workspaceId, workspaceId), eq(t.agentContextDocs.path, path)),
      )
      .orderBy(asc(t.agents.name));
    const skills = await this.db
      .select({ id: t.skills.id, name: t.skills.name })
      .from(t.skillContextDocs)
      .innerJoin(t.skills, eq(t.skillContextDocs.skillId, t.skills.id))
      .where(
        and(eq(t.skillContextDocs.workspaceId, workspaceId), eq(t.skillContextDocs.path, path)),
      )
      .orderBy(asc(t.skills.name));
    return { agents, skills };
  }

  /**
   * Replace an agent's whole list (position = index). Delete-then-insert must be
   * atomic, so every statement runs on `tx` (same shape as `AgentsRepository.setSkills`).
   */
  async replaceAgentDocs(workspaceId: string, agentId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.agentContextDocs)
        .where(
          and(
            eq(t.agentContextDocs.workspaceId, workspaceId),
            eq(t.agentContextDocs.agentId, agentId),
          ),
        );
      if (paths.length === 0) return;
      await tx
        .insert(t.agentContextDocs)
        .values(paths.map((path, position) => ({ workspaceId, agentId, path, position })));
    });
  }

  async replaceSkillDocs(workspaceId: string, skillId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.skillContextDocs)
        .where(
          and(
            eq(t.skillContextDocs.workspaceId, workspaceId),
            eq(t.skillContextDocs.skillId, skillId),
          ),
        );
      if (paths.length === 0) return;
      await tx
        .insert(t.skillContextDocs)
        .values(paths.map((path, position) => ({ workspaceId, skillId, path, position })));
    });
  }

  /** Append `path` after the current last position; a path already attached is left alone. */
  async appendAgentDoc(workspaceId: string, agentId: string, path: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [top] = await tx
        .select({ max: sql<number | null>`max(${t.agentContextDocs.position})` })
        .from(t.agentContextDocs)
        .where(eq(t.agentContextDocs.agentId, agentId));
      await tx
        .insert(t.agentContextDocs)
        .values({ workspaceId, agentId, path, position: (top?.max ?? -1) + 1 })
        .onConflictDoNothing();
    });
  }

  async appendSkillDoc(workspaceId: string, skillId: string, path: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [top] = await tx
        .select({ max: sql<number | null>`max(${t.skillContextDocs.position})` })
        .from(t.skillContextDocs)
        .where(eq(t.skillContextDocs.skillId, skillId));
      await tx
        .insert(t.skillContextDocs)
        .values({ workspaceId, skillId, path, position: (top?.max ?? -1) + 1 })
        .onConflictDoNothing();
    });
  }
}

import type {
  AgentContextDocs,
  AttachedDoc,
  ContextDoc,
  ContextDocContent,
  ContextDocList,
  ContextDocPaths,
  ContextDocUsage,
  InheritedDoc,
  RepoDocReadFailure,
  RepoDocsReader,
  RepoRef,
  SkillContextDocs,
} from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import {
  DOC_TOKEN_CAP,
  MAX_ATTACHED_PATHS,
  MAX_LISTED_DOCS,
  SECTION_TOKEN_CAP,
} from './constants.js';
import {
  docTypeFor,
  isAttachablePath,
  isDocPath,
  orderAndDedupe,
  planSection,
  truncateToTokens,
} from './helpers.js';
import type { ProjectContextRepository } from './repository.js';

/**
 * Narrow dependency set of the project-context use cases. Structural, so this
 * file never imports `Container` (container.ts imports this service; a
 * `Container`-typed constructor would close the cycle `arch:check` forbids).
 * Cross-module data (clone path, active skills) arrives as functions.
 */
export interface ProjectContextDeps {
  repo: Pick<
    ProjectContextRepository,
    | 'repoInWorkspace'
    | 'agentInWorkspace'
    | 'skillInWorkspace'
    | 'agentDocPaths'
    | 'skillDocPathsFor'
    | 'usage'
    | 'replaceAgentDocs'
    | 'replaceSkillDocs'
    | 'appendAgentDoc'
    | 'appendSkillDoc'
  >;
  reader: RepoDocsReader;
  count: (text: string) => number;
  roots: readonly string[];
  clonePathFor: (repo: RepoRef) => string;
  /** Skills that are on at both levels for the agent, in `agent_skills.order`. */
  activeSkills: (agentId: string) => Promise<{ id: string; name: string }[]>;
}

export type SkipReason = RepoDocReadFailure | 'empty' | 'not_cloned' | 'over_cap';

export interface ResolvedDoc {
  path: string;
  content: string;
  tokens: number;
  truncated: boolean;
}

export interface ResolveForRunResult {
  docs: ResolvedDoc[];
  skipped: { path: string; reason: SkipReason }[];
}

type LoadedDoc =
  | { ok: true; text: string; tokens: number; truncated: boolean }
  | { ok: false; reason: RepoDocReadFailure };

export class ProjectContextService {
  constructor(private deps: ProjectContextDeps) {}

  async list(workspaceId: string, repoId: string, q?: string): Promise<ContextDocList> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const clone = this.deps.clonePathFor(repo);
    const roots = [...this.deps.roots];
    const base = { repo: { id: repo.id, full_name: repo.fullName }, roots };
    const listed = await this.deps.reader.listMarkdown(clone);
    if (listed === null) return { ...base, status: 'not_cloned', documents: [], total: 0 };

    const needle = q?.trim().toLowerCase();
    const matches = listed
      .filter((p) => isDocPath(p, this.deps.roots))
      .filter((p) => !needle || p.toLowerCase().includes(needle));
    const documents: ContextDoc[] = [];
    for (const path of matches.slice(0, MAX_LISTED_DOCS)) {
      const doc = await this.load(clone, path);
      documents.push({
        path,
        type: docTypeFor(path, this.deps.roots),
        tokens: doc.ok ? doc.tokens : null,
        truncated: doc.ok ? doc.truncated : false,
      });
    }
    return { ...base, status: 'ok', documents, total: matches.length };
  }

  async content(workspaceId: string, repoId: string, path: string): Promise<ContextDocContent> {
    const repo = await this.requireRepo(workspaceId, repoId);
    this.assertAttachable([path]);
    const res = await this.deps.reader.read(this.deps.clonePathFor(repo), path);
    if (!res.ok) throw new NotFoundError('Document not found');
    return { path, content: res.text };
  }

  async usage(workspaceId: string, path: string): Promise<ContextDocUsage> {
    return this.deps.repo.usage(workspaceId, path);
  }

  async agentView(workspaceId: string, agentId: string, repoId: string): Promise<AgentContextDocs> {
    await this.requireAgent(workspaceId, agentId);
    const repo = await this.requireRepo(workspaceId, repoId);
    const clone = this.deps.clonePathFor(repo);
    const cloned = (await this.deps.reader.listMarkdown(clone)) !== null;

    const ownPaths = await this.deps.repo.agentDocPaths(workspaceId, agentId);
    const skills = await this.deps.activeSkills(agentId);
    const skillRows = await this.deps.repo.skillDocPathsFor(
      workspaceId,
      skills.map((s) => s.id),
    );

    const tokensByPath = new Map<string, number>();
    const attach = async (path: string): Promise<AttachedDoc> => {
      const doc = await this.load(clone, path);
      if (doc.ok) tokensByPath.set(path, doc.tokens);
      return {
        path,
        type: doc.ok ? docTypeFor(path, this.deps.roots) : null,
        found: doc.ok,
        tokens: doc.ok ? doc.tokens : null,
        truncated: doc.ok ? doc.truncated : false,
      };
    };

    const own: AttachedDoc[] = [];
    for (const path of ownPaths) own.push(await attach(path));
    const inherited: InheritedDoc[] = [];
    const skillPaths: string[][] = [];
    for (const skill of skills) {
      const paths = skillRows.filter((r) => r.skillId === skill.id).map((r) => r.path);
      skillPaths.push(paths);
      for (const path of paths) {
        inherited.push({
          ...(await attach(path)),
          skill_id: skill.id,
          skill_name: skill.name,
        });
      }
    }

    const ordered = orderAndDedupe(ownPaths, skillPaths).filter((p) => tokensByPath.has(p));
    const plan = planSection(
      ordered.map((path) => ({ path, tokens: tokensByPath.get(path) as number })),
      SECTION_TOKEN_CAP,
    );
    return {
      repo: { id: repo.id, full_name: repo.fullName, cloned },
      own,
      inherited,
      total_tokens: ordered.reduce((sum, p) => sum + (tokensByPath.get(p) as number), 0),
      cap_tokens: SECTION_TOKEN_CAP,
      left_out: plan.leftOut.map((e) => e.path),
    };
  }

  async skillView(workspaceId: string, skillId: string, repoId: string): Promise<SkillContextDocs> {
    await this.requireSkill(workspaceId, skillId);
    const repo = await this.requireRepo(workspaceId, repoId);
    const clone = this.deps.clonePathFor(repo);
    const cloned = (await this.deps.reader.listMarkdown(clone)) !== null;
    const rows = await this.deps.repo.skillDocPathsFor(workspaceId, [skillId]);

    let total = 0;
    const own: AttachedDoc[] = [];
    for (const { path } of rows) {
      const doc = await this.load(clone, path);
      if (doc.ok) total += doc.tokens;
      own.push({
        path,
        type: doc.ok ? docTypeFor(path, this.deps.roots) : null,
        found: doc.ok,
        tokens: doc.ok ? doc.tokens : null,
        truncated: doc.ok ? doc.truncated : false,
      });
    }
    return { repo: { id: repo.id, full_name: repo.fullName, cloned }, own, total_tokens: total };
  }

  async setAgentDocs(workspaceId: string, agentId: string, paths: string[]): Promise<ContextDocPaths> {
    await this.requireAgent(workspaceId, agentId);
    const unique = this.validatedList(paths);
    await this.deps.repo.replaceAgentDocs(workspaceId, agentId, unique);
    return { paths: unique };
  }

  async setSkillDocs(workspaceId: string, skillId: string, paths: string[]): Promise<ContextDocPaths> {
    await this.requireSkill(workspaceId, skillId);
    const unique = this.validatedList(paths);
    await this.deps.repo.replaceSkillDocs(workspaceId, skillId, unique);
    return { paths: unique };
  }

  async appendAgentDoc(workspaceId: string, agentId: string, path: string): Promise<ContextDocPaths> {
    await this.requireAgent(workspaceId, agentId);
    this.assertAttachable([path]);
    await this.deps.repo.appendAgentDoc(workspaceId, agentId, path);
    return { paths: await this.deps.repo.agentDocPaths(workspaceId, agentId) };
  }

  async appendSkillDoc(workspaceId: string, skillId: string, path: string): Promise<ContextDocPaths> {
    await this.requireSkill(workspaceId, skillId);
    this.assertAttachable([path]);
    await this.deps.repo.appendSkillDoc(workspaceId, skillId, path);
    const rows = await this.deps.repo.skillDocPathsFor(workspaceId, [skillId]);
    return { paths: rows.map((r) => r.path) };
  }

  /**
   * The documents one agent run puts into `## Project context`: attachments read
   * once at run start (agent first, then active skills in order), deduped, each
   * truncated to the per-document cap, then cut at the section cap. Never throws
   * for an unreadable document; it is reported in `skipped` with a reason code.
   */
  async resolveForRun(
    workspaceId: string,
    agentId: string,
    repoRef: RepoRef,
  ): Promise<ResolveForRunResult> {
    const ownPaths = await this.deps.repo.agentDocPaths(workspaceId, agentId);
    const skills = await this.deps.activeSkills(agentId);
    const rows = await this.deps.repo.skillDocPathsFor(
      workspaceId,
      skills.map((s) => s.id),
    );
    const skillPaths = skills.map((s) => rows.filter((r) => r.skillId === s.id).map((r) => r.path));
    const ordered = orderAndDedupe(ownPaths, skillPaths);
    if (ordered.length === 0) return { docs: [], skipped: [] };

    const clone = this.deps.clonePathFor(repoRef);
    const skipped: ResolveForRunResult['skipped'] = [];
    const readable: ResolvedDoc[] = [];
    let cloned: boolean | undefined;
    for (const path of ordered) {
      if (!isAttachablePath(path, this.deps.roots)) {
        skipped.push({ path, reason: 'outside_clone' });
        continue;
      }
      const doc = await this.load(clone, path);
      if (!doc.ok) {
        if (doc.reason === 'missing') {
          cloned ??= (await this.deps.reader.listMarkdown(clone)) !== null;
          skipped.push({ path, reason: cloned ? 'missing' : 'not_cloned' });
        } else {
          skipped.push({ path, reason: doc.reason });
        }
        continue;
      }
      if (doc.text.trim() === '') {
        skipped.push({ path, reason: 'empty' });
        continue;
      }
      readable.push({ path, content: doc.text, tokens: doc.tokens, truncated: doc.truncated });
    }
    const plan = planSection(readable, SECTION_TOKEN_CAP);
    for (const left of plan.leftOut) skipped.push({ path: left.path, reason: 'over_cap' });
    return { docs: plan.kept, skipped };
  }

  /** Read one document and cut it to the per-document token cap. */
  private async load(clone: string, path: string): Promise<LoadedDoc> {
    const res = await this.deps.reader.read(clone, path);
    if (!res.ok) return res;
    const cut = truncateToTokens(res.text, DOC_TOKEN_CAP, this.deps.count);
    return {
      ok: true,
      text: cut.text,
      tokens: cut.tokens,
      truncated: cut.truncated || res.clipped,
    };
  }

  private validatedList(paths: string[]): string[] {
    if (paths.length > MAX_ATTACHED_PATHS) throw new ValidationError('Too many documents');
    this.assertAttachable(paths);
    return orderAndDedupe(paths, []);
  }

  private assertAttachable(paths: string[]): void {
    if (paths.some((p) => !isAttachablePath(p, this.deps.roots))) {
      throw new ValidationError('Not an attachable document path');
    }
  }

  private async requireRepo(workspaceId: string, repoId: string) {
    const repo = await this.deps.repo.repoInWorkspace(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  private async requireAgent(workspaceId: string, agentId: string) {
    const agent = await this.deps.repo.agentInWorkspace(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  private async requireSkill(workspaceId: string, skillId: string) {
    const skill = await this.deps.repo.skillInWorkspace(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  }
}

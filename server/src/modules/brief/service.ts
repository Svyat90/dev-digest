import type {
  BlastRadiusResponse,
  BriefMissingInput,
  BriefTruncatableSource,
  FeatureModelChoice,
  FeatureModelId,
  GitHubClient,
  LLMProvider,
  PrBrief,
  PrIntentRecord,
  Provider,
  RepoRef,
  SmartDiff,
  SmartDiffRole,
} from '@devdigest/shared';
import { PrBrief as PrBriefSchema } from '@devdigest/shared';
import { AppError, ExternalServiceError, NotFoundError } from '../../platform/errors.js';
import { withTimeout } from '../../platform/resilience.js';
import {
  createPromptMeasure,
  logPromptAssembled,
  type PromptLogMode,
} from '../../platform/prompt-log.js';
import { parseClosingIssueRefs } from '../../domain/intent/closing-refs.js';
import type { BriefRepository } from './repository.js';
import {
  BRIEF_INPUT_TOKEN_BUDGET,
  BRIEF_MODEL_TIMEOUT_MS,
  ISSUE_FETCH_DEADLINE_MS,
  MAX_BODY_SCAN_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_DOCUMENTS,
  MAX_ISSUE_CHARS,
  MAX_LINKED_ISSUES,
} from './constants.js';
import {
  blastFacts,
  capChars,
  classifyGenerationError,
  classifySourceError,
  computeMissingInputs,
  finalizeAnswer,
  fitBriefInput,
  hunkRanges,
  isBlastAvailable,
} from './helpers.js';
import {
  BRIEF_SCHEMA_NAME,
  BriefAnswerSchema,
  buildBriefMessages,
  describeBriefPrompt,
  renderBriefSections,
} from './prompt.js';
import type {
  BriefBlastFact,
  BriefDocumentFact,
  BriefDropCounts,
  BriefFactSource,
  BriefInput,
  BriefIntentFact,
  BriefIssueFact,
} from './types.js';

/**
 * Narrow dependency set of the brief use cases: functions over the container's
 * facades and ports, never `Container` (server/INSIGHTS.md, 2026-09-22) and
 * never another module's types (2026-09-30). The container builds it.
 */
export interface BriefDeps {
  repo: Pick<BriefRepository, 'getPull' | 'getRepo' | 'listFiles' | 'get' | 'upsert'>;
  intent: (workspaceId: string, prId: string) => Promise<PrIntentRecord | null>;
  blast: (workspaceId: string, prId: string) => Promise<BlastRadiusResponse>;
  smartDiff: (workspaceId: string, prId: string) => Promise<SmartDiff>;
  enabledAgentIds: (workspaceId: string) => Promise<string[]>;
  resolveDocs: (
    workspaceId: string,
    agentId: string,
    repo: RepoRef,
  ) => Promise<{ docs: { path: string; content: string }[] }>;
  github: () => Promise<Pick<GitHubClient, 'getIssue'>>;
  llm: (provider: Provider) => Promise<LLMProvider>;
  resolveFeatureModel: (workspaceId: string, id: FeatureModelId) => Promise<FeatureModelChoice>;
  tokenizer: { count(text: string): number };
  /** Effective PROMPT_LOG mode: `off` skips the `prompt.assembled` record and its measuring. */
  promptLogMode: PromptLogMode;
}

/** Where the generation records go and the ids that tie them to a request. */
export interface BriefLogContext {
  logger: { info(obj: unknown, msg?: string): void; error(obj: unknown, msg?: string): void };
  correlation: { pr_id: string; request_id?: string };
}

interface DegradedEntry {
  source: string;
  reason: string;
}

/** Mutable state behind the one `brief.generation` record. Counts, enums and codes only. */
interface GenerationState {
  outcome: 'ok' | 'failed';
  reason?: string;
  provider: string | null;
  model: string | null;
  attempts: number;
  tokensInBySource: Record<string, number>;
  tokensOut: number | null;
  costUsd: number | null;
  dropped: BriefDropCounts;
  truncated: BriefTruncatableSource[];
  forceDropped: boolean;
  degraded: DegradedEntry[];
}

const ISSUE_SOURCE: BriefFactSource = 'issue';

export class BriefService {
  constructor(private deps: BriefDeps) {}

  /** GET — the stored brief, or `null`. 404 when the PR is not in the workspace. Never calls a model, GitHub or git. */
  async get(workspaceId: string, prId: string): Promise<PrBrief | null> {
    const pull = await this.deps.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return this.deps.repo.get(prId);
  }

  /** POST — gather the facts, make one model call, validate, store. */
  async generate(workspaceId: string, prId: string, log: BriefLogContext): Promise<PrBrief> {
    const { deps } = this;
    const started = Date.now();
    // The workspace check comes first; this row is the consistency boundary (title, body, head SHA).
    const pull = await deps.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const state: GenerationState = {
      outcome: 'failed',
      provider: null,
      model: null,
      attempts: 0,
      tokensInBySource: {},
      tokensOut: null,
      costUsd: null,
      dropped: { risks: 0, riskRefs: 0, focus: 0 },
      truncated: [],
      forceDropped: false,
      degraded: [],
    };

    try {
      const brief = await this.run(workspaceId, pull, log, state);
      state.outcome = 'ok';
      return brief;
    } catch (err) {
      state.reason = err instanceof AppError ? err.code : 'error';
      throw err;
    } finally {
      log.logger.info({
        event: 'brief.generation',
        pr_id: prId,
        outcome: state.outcome,
        ...(state.reason ? { reason: state.reason } : {}),
        provider: state.provider,
        model: state.model,
        attempts: state.attempts,
        tokens_in_by_source: state.tokensInBySource,
        tokens_out: state.tokensOut,
        cost_usd: state.costUsd,
        duration_ms: Math.max(0, Date.now() - started),
        dropped: state.dropped,
        truncated: state.truncated,
        force_dropped: state.forceDropped,
        degraded: state.degraded,
      });
    }
  }

  // ------------------------------------------------------------------ internals

  /**
   * One fact source: a failure never propagates. `absent` is an expected
   * missing input; `unavailable` also lands in the record's `degraded` list;
   * `unexpected` is additionally an error-level record (class name only).
   */
  private async guard<T>(
    source: BriefFactSource,
    prId: string,
    log: BriefLogContext,
    state: GenerationState,
    fn: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      const { kind, reason } = classifySourceError(err);
      if (kind === 'unavailable') state.degraded.push({ source, reason });
      if (kind === 'unexpected') {
        log.logger.error({ event: 'brief.source_error', pr_id: prId, source, error: reason });
      }
      return { ok: false };
    }
  }

  private async run(
    workspaceId: string,
    pull: NonNullable<Awaited<ReturnType<BriefRepository['getPull']>>>,
    log: BriefLogContext,
    state: GenerationState,
  ): Promise<PrBrief> {
    const { deps } = this;
    const repoRow = await deps.repo.getRepo(workspaceId, pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    const repoRef: RepoRef = { owner: repoRow.owner, name: repoRow.name };
    const files = await deps.repo.listFiles(pull.id);

    const preTruncated: BriefTruncatableSource[] = [];
    const markTruncated = (s: BriefTruncatableSource): void => {
      if (!preTruncated.includes(s)) preTruncated.push(s);
    };

    const description = capChars((pull.body ?? '').trim(), MAX_DESCRIPTION_CHARS);
    if (description.cut) markTruncated('description');
    const refs = parseClosingIssueRefs(
      capChars(pull.body ?? '', MAX_BODY_SCAN_CHARS).text,
      repoRef,
      MAX_LINKED_ISSUES,
    );

    const [roles, intent, blast, documents, issues] = await Promise.all([
      this.collectRoles(workspaceId, pull.id, log, state),
      this.collectIntent(workspaceId, pull, log, state),
      this.collectBlast(workspaceId, pull.id, log, state),
      this.collectDocuments(workspaceId, pull.id, repoRef, log, state),
      this.collectIssues(refs, pull.id, log, state),
    ]);
    if (documents.overflow) markTruncated('documents');
    if (issues.cut) markTruncated('linked_issues');

    const input: BriefInput = {
      title: pull.title,
      description: description.text,
      issues: issues.facts,
      intent,
      blast: blast?.fact ?? null,
      files: files.map((f) => ({
        path: f.path,
        role: roles.get(f.path) ?? 'core',
        additions: f.additions,
        deletions: f.deletions,
        ranges: hunkRanges(f.patch),
      })),
      omittedFiles: 0,
      documents: documents.facts,
      missing: computeMissingInputs({
        intent,
        blast: blast?.fact ?? null,
        issuesReferenced: refs.length,
        issuesFetched: issues.facts.length,
        documents: documents.facts.length,
      }),
    };

    const measure = (i: BriefInput): number =>
      renderBriefSections(i).reduce((n, s) => n + deps.tokenizer.count(s.text), 0);
    const fitted = fitBriefInput(input, measure, BRIEF_INPUT_TOKEN_BUDGET);
    state.truncated = [...new Set([...preTruncated, ...fitted.truncated])];
    state.forceDropped = fitted.forceDropped;
    if (!fitted.fits) {
      throw new AppError('brief_input_over_budget', 'Brief input is over budget', 500);
    }
    for (const s of renderBriefSections(fitted.input)) {
      state.tokensInBySource[s.name] = deps.tokenizer.count(s.text);
    }

    // Config problems throw before anything is sent, so `attempts` stays 0.
    const { provider, model } = await deps.resolveFeatureModel(workspaceId, 'risk_brief');
    state.provider = provider;
    state.model = model;
    const llm = await deps.llm(provider);
    this.logPrompt(log, fitted.input, provider, model);

    let result;
    state.attempts = 1;
    try {
      result = await llm.completeStructured({
        model,
        schema: BriefAnswerSchema,
        schemaName: BRIEF_SCHEMA_NAME,
        messages: buildBriefMessages(fitted.input),
        temperature: 0,
        maxRetries: 0,
        timeoutMs: BRIEF_MODEL_TIMEOUT_MS,
      });
    } catch (err) {
      const kind = classifyGenerationError(err);
      if (kind === 'invalid_answer') {
        throw new AppError('invalid_model_answer', 'Invalid model answer', 502);
      }
      if (kind === 'not_configured') throw err;
      // The message never echoes provider text: it can carry request content.
      throw new ExternalServiceError('Model provider unavailable');
    }
    state.tokensOut = result.tokensOut;
    state.costUsd = result.costUsd;

    const finalized = finalizeAnswer(
      result.data,
      new Set(files.map((f) => f.path)),
      blast?.allowFiles ?? new Set<string>(),
    );
    state.dropped = finalized.dropped;

    const brief: PrBrief = PrBriefSchema.parse({
      summary: finalized.summary,
      intent: intent
        ? { intent: intent.intent, in_scope: intent.inScope, out_of_scope: intent.outOfScope }
        : null,
      blast: blast
        ? {
            changed_symbols: blast.snapshot.changed_symbols,
            downstream: blast.snapshot.downstream,
            summary: blast.snapshot.summary,
          }
        : null,
      risks: { risks: finalized.risks },
      history: null,
      review_focus: finalized.review_focus,
      head_sha: pull.headSha,
      generated_at: new Date().toISOString(),
      missing_inputs: fitted.input.missing satisfies BriefMissingInput[],
      truncated_sources: state.truncated,
      provider,
      model: result.model,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
    });
    await deps.repo.upsert(pull.id, brief);
    return brief;
  }

  /** Best-effort `prompt.assembled` record: it can never fail the generation. */
  private logPrompt(log: BriefLogContext, input: BriefInput, provider: string, model: string): void {
    const mode = this.deps.promptLogMode;
    if (mode === 'off') return;
    try {
      logPromptAssembled(
        log.logger,
        {
          component: 'risk_brief',
          provider,
          model,
          correlation: log.correlation,
          sections: describeBriefPrompt(input, createPromptMeasure(mode, this.deps.tokenizer)),
        },
        mode,
      );
    } catch {
      /* never fail a generation over a log line */
    }
  }

  private async collectRoles(
    workspaceId: string,
    prId: string,
    log: BriefLogContext,
    state: GenerationState,
  ): Promise<Map<string, SmartDiffRole>> {
    const r = await this.guard('smart_diff', prId, log, state, () => this.deps.smartDiff(workspaceId, prId));
    const roles = new Map<string, SmartDiffRole>();
    if (r.ok) for (const g of r.value.groups) for (const f of g.files) roles.set(f.path, g.role);
    return roles;
  }

  private async collectIntent(
    workspaceId: string,
    pull: { id: string; headSha: string },
    log: BriefLogContext,
    state: GenerationState,
  ): Promise<BriefIntentFact | null> {
    const r = await this.guard('intent', pull.id, log, state, () => this.deps.intent(workspaceId, pull.id));
    if (!r.ok || !r.value) return null;
    const rec = r.value;
    return {
      intent: rec.intent,
      inScope: rec.in_scope,
      outOfScope: rec.out_of_scope,
      stale: rec.head_sha !== pull.headSha,
    };
  }

  private async collectBlast(
    workspaceId: string,
    prId: string,
    log: BriefLogContext,
    state: GenerationState,
  ): Promise<{
    fact: BriefBlastFact;
    allowFiles: Set<string>;
    snapshot: Pick<BlastRadiusResponse, 'changed_symbols' | 'downstream' | 'summary'>;
  } | null> {
    const r = await this.guard('blast', prId, log, state, () => this.deps.blast(workspaceId, prId));
    if (!r.ok) return null;
    if (!isBlastAvailable(r.value)) {
      state.degraded.push({ source: 'blast', reason: r.value.reason ?? 'no_data' });
      return null;
    }
    const { fact, allowFiles } = blastFacts(r.value);
    const { changed_symbols, downstream, summary } = r.value;
    return { fact, allowFiles, snapshot: { changed_symbols, downstream, summary } };
  }

  private async collectDocuments(
    workspaceId: string,
    prId: string,
    repoRef: RepoRef,
    log: BriefLogContext,
    state: GenerationState,
  ): Promise<{ facts: BriefDocumentFact[]; overflow: boolean }> {
    const ids = await this.guard('documents', prId, log, state, () => this.deps.enabledAgentIds(workspaceId));
    if (!ids.ok) return { facts: [], overflow: false };
    const perAgent = await Promise.all(
      ids.value.map((agentId) =>
        this.guard('documents', prId, log, state, () => this.deps.resolveDocs(workspaceId, agentId, repoRef)),
      ),
    );
    const seen = new Set<string>();
    const all: BriefDocumentFact[] = [];
    for (const r of perAgent) {
      if (!r.ok) continue;
      for (const d of r.value.docs) {
        if (seen.has(d.path)) continue;
        seen.add(d.path);
        all.push({ path: d.path, text: d.content });
      }
    }
    return { facts: all.slice(0, MAX_DOCUMENTS), overflow: all.length > MAX_DOCUMENTS };
  }

  /** All issue fetches start together and share ONE deadline. */
  private async collectIssues(
    refs: { owner: string; name: string; number: number }[],
    prId: string,
    log: BriefLogContext,
    state: GenerationState,
  ): Promise<{ facts: BriefIssueFact[]; cut: boolean }> {
    const results = await Promise.allSettled(
      refs.map((ref) =>
        withTimeout(
          (async () => {
            const gh = await this.deps.github();
            return gh.getIssue({ owner: ref.owner, name: ref.name }, ref.number);
          })(),
          ISSUE_FETCH_DEADLINE_MS,
        ),
      ),
    );
    const facts: BriefIssueFact[] = [];
    let cut = false;
    results.forEach((res, idx) => {
      const ref = refs[idx]!;
      if (res.status === 'rejected') {
        const { kind, reason } = classifySourceError(res.reason);
        if (kind === 'unavailable') state.degraded.push({ source: ISSUE_SOURCE, reason });
        if (kind === 'unexpected') {
          log.logger.error({ event: 'brief.source_error', pr_id: prId, source: ISSUE_SOURCE, error: reason });
        }
        return;
      }
      const { title, body } = res.value;
      if (!body || !body.trim()) return;
      const text = capChars(`${title}\n\n${body}`, MAX_ISSUE_CHARS);
      if (text.cut) cut = true;
      facts.push({ ref: `${ref.owner}/${ref.name}#${ref.number}`, text: text.text });
    });
    return { facts, cut };
  }
}

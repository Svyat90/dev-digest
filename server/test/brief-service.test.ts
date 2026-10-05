import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlastRadiusResponse, PrIntentRecord, SmartDiff, StructuredRequest } from '@devdigest/shared';
import { PrBrief } from '@devdigest/shared';
import { ConfigError, InvalidModelOutputError, NotFoundError } from '../src/platform/errors.js';
import { TimeoutError } from '../src/platform/resilience.js';
import { TiktokenTokenizer } from '../src/adapters/tokenizer/index.js';
import { BriefRepository } from '../src/modules/brief/repository.js';
import { BriefService, type BriefDeps, type BriefLogContext } from '../src/modules/brief/service.js';
import { renderBriefSections } from '../src/modules/brief/prompt.js';
import {
  BRIEF_INPUT_TOKEN_BUDGET,
  ISSUE_FETCH_DEADLINE_MS,
  MAX_DOCUMENTS,
} from '../src/modules/brief/constants.js';
import type { BriefInput } from '../src/modules/brief/types.js';

const PULL = {
  id: 'p1',
  repoId: 'r1',
  title: 'Add retry',
  body: 'SECRET-DESCRIPTION text. Closes #471',
  base: 'main',
  headSha: 'sha-head',
};

const PATCH = '@@ -1,2 +10,3 @@\n+a\n+b\n+c';

const intentRecord = (headSha: string): PrIntentRecord => ({
  pr_id: 'p1',
  intent: 'Add retry to the client',
  in_scope: ['retry'],
  out_of_scope: [],
  confidence: 'high',
  sources: [],
  missing_context: [],
  head_sha: headSha,
  provider: null,
  model: null,
  tokens_in: null,
  tokens_out: null,
  updated_at: '2026-01-01T00:00:00Z',
});

const blastOk: BlastRadiusResponse = {
  changed_symbols: [{ name: 'run', file: 'src/a.ts', kind: 'function' }],
  downstream: [
    {
      symbol: 'run',
      callers: [{ name: 'main', file: 'src/caller.ts', line: 3 }],
      endpoints_affected: [],
      crons_affected: [],
    },
  ],
  summary: 'One symbol changed, one caller.',
  degraded: false,
  reason: null,
  index_status: 'full',
  index_sha: 'x',
  limits: { max_callers_per_symbol: 10 },
};

const smartDiff: SmartDiff = {
  groups: [
    {
      role: 'tests',
      files: [{ path: 'src/a.test.ts', additions: 1, deletions: 0, finding_lines: [] }],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 4, proposed_splits: [] },
};

const goodAnswer = {
  summary: 'MODEL-SUMMARY adds retry.',
  risks: [
    {
      kind: 'behavior',
      title: 'Retry loop',
      explanation: 'May retry forever.',
      severity: 'high' as const,
      file_refs: [
        { file: 'src/a.ts', start_line: 10, end_line: null },
        { file: 'src/invented.ts', start_line: 1, end_line: null },
      ],
    },
  ],
  review_focus: [{ file: 'src/a.ts', line: 10, reason: 'Check the loop' }],
};

interface Harness {
  svc: BriefService;
  deps: BriefDeps;
  upsert: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  getIssue: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  log: BriefLogContext;
  sent: () => string;
}

function build(over: Partial<BriefDeps> = {}, answer: unknown = goodAnswer): Harness {
  const upsert = vi.fn(async () => undefined);
  const complete = vi.fn(async (req: StructuredRequest<unknown>) => ({
    data: answer,
    model: req.model,
    tokensIn: 900,
    tokensOut: 120,
    costUsd: 0.0042 as number | null,
    raw: '',
    attempts: 1,
  }));
  const getIssue = vi.fn(async () => ({ number: 471, title: 'Flaky client', body: 'It fails', state: 'open' }));
  const info = vi.fn();
  const error = vi.fn();
  const deps: BriefDeps = {
    repo: {
      getPull: vi.fn(async (_ws: string, id: string) => (id === 'p1' ? { ...PULL } : undefined)),
      getRepo: vi.fn(async () => ({ owner: 'acme', name: 'api' })),
      listFiles: vi.fn(async () => [
        { path: 'src/a.ts', additions: 3, deletions: 0, patch: PATCH },
        { path: 'src/a.test.ts', additions: 1, deletions: 0, patch: null },
      ]),
      get: vi.fn(async () => null),
      upsert,
    } as unknown as BriefDeps['repo'],
    intent: vi.fn(async () => intentRecord('sha-head')),
    blast: vi.fn(async () => blastOk),
    smartDiff: vi.fn(async () => smartDiff),
    enabledAgentIds: vi.fn(async () => ['ag1']),
    resolveDocs: vi.fn(async () => ({ docs: [{ path: 'docs/a.md', content: 'conventions' }] })),
    github: vi.fn(async () => ({ getIssue })),
    llm: vi.fn(async () => ({ completeStructured: complete }) as never),
    resolveFeatureModel: vi.fn(async () => ({ provider: 'openai' as const, model: 'gpt-4.1' })),
    tokenizer: { count: (t: string) => Math.ceil(t.length / 4) },
    promptLogMode: 'off',
    ...over,
  };
  const log: BriefLogContext = { logger: { info, error }, correlation: { pr_id: 'p1' } };
  const sent = () => JSON.stringify((complete.mock.calls[0]?.[0] as StructuredRequest<unknown>).messages);
  return { svc: new BriefService(deps), deps, upsert, complete, getIssue, info, error, log, sent };
}

const records = (info: ReturnType<typeof vi.fn>) =>
  info.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((r) => r.event === 'brief.generation');

afterEach(() => vi.useRealTimers());

describe('BriefService.generate', () => {
  it('asks the risk_brief model once, drops invented files and stores the brief at the loaded head SHA', async () => {
    const h = build();
    const out = await h.svc.generate('ws', 'p1', h.log);

    expect(() => PrBrief.parse(out)).not.toThrow();
    expect(out.head_sha).toBe('sha-head');
    expect(out.provider).toBe('openai');
    expect(out.model).toBe('gpt-4.1');
    expect(h.deps.resolveFeatureModel).toHaveBeenCalledWith('ws', 'risk_brief');
    expect(h.complete).toHaveBeenCalledTimes(1);
    expect(h.complete.mock.calls[0]![0]).toMatchObject({ maxRetries: 0, temperature: 0, timeoutMs: 60_000 });
    expect(out.risks.risks[0]!.file_refs.map((r) => r.file)).toEqual(['src/a.ts']);
    expect(out.missing_inputs).toEqual([]);
    expect(h.upsert).toHaveBeenCalledTimes(1);
    expect(h.upsert).toHaveBeenCalledWith('p1', out);
  });

  it('answers per class: absent, unavailable and unexpected sources never fail the generation', async () => {
    // absent: the linked issue is a 404
    const absent = build();
    absent.getIssue.mockRejectedValue({ status: 404 });
    const a = await absent.svc.generate('ws', 'p1', absent.log);
    expect(a.missing_inputs).toEqual(['linked_issue']);
    expect(records(absent.info)[0]!.degraded).toEqual([]);
    expect(absent.error).not.toHaveBeenCalled();

    // unavailable: blast times out
    const unavailable = build({ blast: vi.fn(async () => { throw new TimeoutError(1); }) });
    const u = await unavailable.svc.generate('ws', 'p1', unavailable.log);
    expect(u.missing_inputs).toContain('blast');
    expect(records(unavailable.info)[0]!.degraded).toEqual([{ source: 'blast', reason: 'timeout' }]);
    expect(unavailable.error).not.toHaveBeenCalled();

    // unexpected: the document resolver has a bug
    const unexpected = build({ resolveDocs: vi.fn(async () => { throw new TypeError('secret detail'); }) });
    const x = await unexpected.svc.generate('ws', 'p1', unexpected.log);
    expect(x.missing_inputs).toContain('documents');
    expect(unexpected.error).toHaveBeenCalledTimes(1);
    const rec = unexpected.error.mock.calls[0]![0] as Record<string, unknown>;
    expect(rec).toMatchObject({ event: 'brief.source_error', source: 'documents' });
    expect(JSON.stringify(rec)).not.toContain('secret detail');
  });

  it('starts every issue fetch together and waits one deadline, not three', async () => {
    vi.useFakeTimers();
    const h = build({
      repo: {
        ...build().deps.repo,
        getPull: async () => ({ ...PULL, body: 'Closes #1\nFixes #2\nResolves #3' }),
      } as unknown as BriefDeps['repo'],
    });
    h.getIssue.mockImplementation(() => new Promise(() => undefined));
    const p = h.svc.generate('ws', 'p1', h.log);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.getIssue).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(ISSUE_FETCH_DEADLINE_MS + 1);
    const out = await p;
    expect(out.missing_inputs).toContain('linked_issue');
    expect(h.complete).toHaveBeenCalledTimes(1);
  });

  it('caps the attached documents at MAX_DOCUMENTS and records the truncation', async () => {
    const docs = Array.from({ length: 25 }, (_, i) => ({ path: `docs/${i}.md`, content: `doc ${i}` }));
    const h = build({ resolveDocs: vi.fn(async () => ({ docs })) });
    const out = await h.svc.generate('ws', 'p1', h.log);
    expect(out.truncated_sources).toContain('documents');
    expect(h.sent()).toContain('docs/19.md');
    expect(h.sent()).not.toContain('docs/20.md');
    expect(MAX_DOCUMENTS).toBe(20);
  });

  it('never sends more than the token budget, even for huge documents', async () => {
    const tokenizer = new TiktokenTokenizer();
    const docs = Array.from({ length: 30 }, (_, i) => ({ path: `docs/${i}.md`, content: 'word '.repeat(20_000) }));
    const h = build({ resolveDocs: vi.fn(async () => ({ docs })), tokenizer });
    await h.svc.generate('ws', 'p1', h.log);
    const req = h.complete.mock.calls[0]![0] as StructuredRequest<unknown>;
    const total = req.messages.reduce((n, m) => n + tokenizer.count(m.content), 0);
    expect(total).toBeLessThanOrEqual(BRIEF_INPUT_TOKEN_BUDGET);
    expect(records(h.info)[0]!.truncated).toContain('documents');
  });

  it('records a forced drop when the floors of the sources still do not fit', async () => {
    const docs = Array.from({ length: 30 }, (_, i) => ({ path: `docs/${i}.md`, content: 'word '.repeat(20_000) }));
    // One token per char makes 20 documents at the 500-char floor exceed the budget.
    const h = build({ resolveDocs: vi.fn(async () => ({ docs })), tokenizer: { count: (t) => t.length } });
    await h.svc.generate('ws', 'p1', h.log);
    const req = h.complete.mock.calls[0]![0] as StructuredRequest<unknown>;
    expect(req.messages.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(BRIEF_INPUT_TOKEN_BUDGET);
    expect(records(h.info)[0]!.force_dropped).toBe(true);
  });

  it('keeps the never-shortened parts of a worst-case input within the budget', () => {
    const tokenizer = new TiktokenTokenizer();
    const item = (c: string) => c.repeat(200);
    const input: BriefInput = {
      title: 'T'.repeat(256),
      description: '',
      issues: [],
      intent: {
        intent: 'i'.repeat(600),
        inScope: Array.from({ length: 8 }, () => item('s')),
        outOfScope: Array.from({ length: 8 }, () => item('o')),
        stale: true,
      },
      blast: { summary: 'b'.repeat(300), callerFiles: [] },
      files: [],
      omittedFiles: 0,
      documents: [],
      missing: ['intent', 'intent_stale', 'blast', 'linked_issue', 'documents'],
    };
    const total = renderBriefSections(input).reduce((n, s) => n + tokenizer.count(s.text), 0);
    expect(total).toBeLessThanOrEqual(BRIEF_INPUT_TOKEN_BUDGET);
  });

  it('sends a stale intent and labels it', async () => {
    const h = build({ intent: vi.fn(async () => intentRecord('older-sha')) });
    const out = await h.svc.generate('ws', 'p1', h.log);
    expect(out.missing_inputs).toEqual(['intent_stale']);
    expect(out.intent?.intent).toBe('Add retry to the client');
    expect(h.sent()).toContain('Add retry to the client');
  });

  it('fails an invalid answer with invalid_model_answer and stores nothing', async () => {
    const h = build();
    h.complete.mockRejectedValue(new InvalidModelOutputError('bad json'));
    await expect(h.svc.generate('ws', 'p1', h.log)).rejects.toMatchObject({
      code: 'invalid_model_answer',
      statusCode: 502,
    });
    expect(h.upsert).not.toHaveBeenCalled();
    expect(records(h.info)[0]).toMatchObject({ outcome: 'failed', attempts: 1, cost_usd: null });
  });

  it('rethrows a config error before sending and logs attempts 0', async () => {
    const h = build({ llm: vi.fn(async () => { throw new ConfigError('no key'); }) });
    await expect(h.svc.generate('ws', 'p1', h.log)).rejects.toBeInstanceOf(ConfigError);
    expect(h.complete).not.toHaveBeenCalled();
    expect(records(h.info)[0]).toMatchObject({ attempts: 0, cost_usd: null });
  });

  it('does not touch the model, facts or the brief for a PR outside the workspace', async () => {
    const h = build();
    await expect(h.svc.generate('ws', 'other', h.log)).rejects.toBeInstanceOf(NotFoundError);
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.deps.intent).not.toHaveBeenCalled();
    await expect(h.svc.get('ws', 'other')).rejects.toBeInstanceOf(NotFoundError);
    expect(h.deps.repo.get).not.toHaveBeenCalled();
  });

  it('writes exactly one content-free generation record with cost and duration', async () => {
    const h = build();
    await h.svc.generate('ws', 'p1', h.log);
    const recs = records(h.info);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ outcome: 'ok', attempts: 1, cost_usd: 0.0042, provider: 'openai' });
    expect(recs[0]!.duration_ms).toBeGreaterThanOrEqual(0);
    const text = JSON.stringify(recs[0]);
    expect(text).not.toContain('SECRET-DESCRIPTION');
    expect(text).not.toContain('MODEL-SUMMARY');

    const unpriced = build();
    unpriced.complete.mockImplementation(async (req: StructuredRequest<unknown>) => ({
      data: goodAnswer,
      model: req.model,
      tokensIn: 1,
      tokensOut: 1,
      costUsd: null,
      raw: '',
      attempts: 1,
    }));
    await unpriced.svc.generate('ws', 'p1', unpriced.log);
    expect(records(unpriced.info)[0]!.cost_usd).toBeNull();
  });
});

describe('BriefService.get / BriefRepository.get', () => {
  it('reads the stored brief without any model call', async () => {
    const h = build();
    expect(await h.svc.get('ws', 'p1')).toBeNull();
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.deps.github).not.toHaveBeenCalled();
  });

  it('reads a stored row that fails PrBrief as null', async () => {
    const db = {
      select: () => ({ from: () => ({ where: async () => [{ json: { summary: 1 } }] }) }),
    };
    const repo = new BriefRepository(db as never);
    expect(await repo.get('p1')).toBeNull();
  });
});

#!/usr/bin/env node
// Collects deterministic metrics for one Claude Code session and its subagents:
// tokens, agents, launch order, durations, tool calls, errors, repeated reads,
// human friction. Reads the transcripts Claude Code writes under
// ~/.claude/projects/<project-slug>/; writes nothing. Output: JSON on stdout.
//
// Usage:
//   node collect.mjs [--session <id|path>] [--since <ISO>] [--until <ISO>]
//                    [--project-dir <dir>] [--prices <json>]
//
// --session      session id or .jsonl path (default: the newest session of this project)
// --since/until  limit the window to one workflow inside a longer session
// --project-dir  transcript folder (default: derived from the current directory)
// --prices       JSON {"<model>": {"input": $, "output": $, "cacheRead": $, "cacheWrite": $}}
//                in USD per million tokens; cost is omitted when absent or null

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
const AGENT_LAUNCH_TOOLS = new Set(['Agent', 'Task']);
// User-role lines the harness writes itself; everything else is typed by the human.
const HARNESS_PREFIXES = [
  '<agent-message', '<task-notification', '<system-reminder', '<command-', '<local-command',
  '[Request interrupted', 'Caveat:',
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) fail(`unexpected argument: ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) fail(`missing value for ${key}`);
    args[key.slice(2)] = value;
    i++;
  }
  return args;
}

function fail(message) {
  process.stderr.write(`collect.mjs: ${message}\n`);
  process.exit(2);
}

function projectDirFor(cwd) {
  return join(homedir(), '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
}

function readJsonl(path) {
  const events = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // A line cut mid-write by a live session; skip it.
    }
  }
  return events;
}

function resolveSession(args, projectDir) {
  if (args.session?.endsWith('.jsonl')) return resolve(args.session);
  if (args.session) return join(projectDir, `${args.session}.jsonl`);
  // The newest transcript by mtime can be another session running concurrently.
  const current = process.env.CLAUDE_CODE_SESSION_ID;
  if (current && existsSync(join(projectDir, `${current}.jsonl`))) return join(projectDir, `${current}.jsonl`);
  if (!existsSync(projectDir)) fail(`no transcript folder at ${projectDir}`);
  const newest = readdirSync(projectDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, mtime: statSync(join(projectDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (!newest) fail(`no session transcripts in ${projectDir}`);
  return join(projectDir, newest.f);
}

function inWindow(ts, window) {
  if (!ts) return true;
  if (window.since && ts < window.since) return false;
  if (window.until && ts > window.until) return false;
  return true;
}

function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0, turns: 0 };
}

function addTokens(into, from) {
  for (const k of Object.keys(into)) into[k] += from[k] ?? 0;
  return into;
}

// One API response can be written as several lines sharing message.id; count it once.
function tokensOf(events) {
  const byMessage = new Map();
  for (const e of events) {
    if (e.type !== 'assistant' || !e.message?.usage) continue;
    byMessage.set(e.message.id ?? e.uuid, { usage: e.message.usage, model: e.message.model });
  }
  const total = emptyTokens();
  const byModel = {};
  for (const { usage: u, model } of byMessage.values()) {
    const t = {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      thinking: u.output_tokens_details?.thinking_tokens ?? 0,
      turns: 1,
    };
    addTokens(total, t);
    addTokens((byModel[model ?? 'unknown'] ??= emptyTokens()), t);
  }
  return { total, byModel };
}

function cacheHitRatio(t) {
  const prompt = t.input + t.cacheRead + t.cacheWrite;
  return prompt ? round(t.cacheRead / prompt, 3) : null;
}

function costOf(byModel, prices) {
  if (!prices) return null;
  let usd = 0;
  for (const [model, t] of Object.entries(byModel)) {
    const p = prices[model];
    if (!p || [p.input, p.output, p.cacheRead, p.cacheWrite].some((v) => typeof v !== 'number')) return null;
    usd += (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * p.cacheWrite) / 1e6;
  }
  return round(usd, 4);
}

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// Human-readable forms for the report: 4.2k / 86k / 1.4M tokens, 45 s / 2 min 11 s / 12 h 37 min.
function compact(n, unit) {
  const v = n / unit;
  return v < 10 ? String(round(v, 1)) : String(Math.round(v));
}

function formatTokens(n) {
  if (n == null) return null;
  if (n < 1e3) return String(n);
  if (n < 1e6) return compact(n, 1e3) === '1000' ? '1M' : `${compact(n, 1e3)}k`;
  return `${compact(n, 1e6)}M`;
}

function formatDuration(ms) {
  if (ms == null) return null;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} s`;
  if (totalSec < 3600) {
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return sec ? `${min} min ${sec} s` : `${min} min`;
  }
  const totalMin = Math.round(totalSec / 60);
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min ? `${h} h ${min} min` : `${h} h`;
}

function displayTokens(t) {
  return Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'turns').map(([k, v]) => [k, formatTokens(v)]));
}

function toolUses(events) {
  const uses = [];
  for (const e of events) {
    if (e.type !== 'assistant') continue;
    for (const c of e.message?.content ?? []) {
      if (c.type === 'tool_use') uses.push({ id: c.id, name: c.name, input: c.input ?? {}, ts: e.timestamp });
    }
  }
  return uses;
}

function toolErrors(events, nameById) {
  const errors = [];
  for (const e of events) {
    if (e.type !== 'user' || !Array.isArray(e.message?.content)) continue;
    for (const c of e.message.content) {
      if (c.type !== 'tool_result' || c.is_error !== true) continue;
      const text = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
      errors.push({ tool: nameById.get(c.tool_use_id) ?? 'unknown', kind: classifyError(text), text: text.slice(0, 200), ts: e.timestamp });
    }
  }
  return errors;
}

function classifyError(text) {
  if (/doesn't want to proceed|rejected|denied/i.test(text)) return 'rejected_by_user';
  if (/hook error|blocked/i.test(text)) return 'blocked_by_hook';
  if (/InputValidationError|invalid input/i.test(text)) return 'bad_tool_input';
  if (/must Read|has not been read|modified since/i.test(text)) return 'stale_or_unread_file';
  return 'tool_error';
}

function countBy(items, key) {
  const out = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

function readsOf(uses) {
  return countBy(uses.filter((u) => u.name === 'Read' && u.input.file_path), (u) => u.input.file_path);
}

function statusOf(report) {
  // Agents report "Status: X"; plan-verifier reports "Overall: X".
  return report.match(/^\s*\**(?:Status|Overall|Verdict)\**:\s*\**([A-Z_]+)/m)?.[1] ?? null;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  return (content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

function msBetween(a, b) {
  return a && b ? new Date(b) - new Date(a) : null;
}

function collectAgent(dir, file, window, resumesById) {
  const agentId = basename(file, '.jsonl').replace(/^agent-/, '');
  const metaPath = join(dir, `agent-${agentId}.meta.json`);
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
  const all = readJsonl(join(dir, file));
  const events = all.filter((e) => inWindow(e.timestamp, window));
  if (!events.length) return null;

  // A dispatch is the Agent launch plus each main-session SendMessage to this agent.
  // promptId is not used: it changes with the main session's turns, not with resumes.
  const resumeTimes = (resumesById.get(agentId) ?? []).sort();
  const segments = [];
  let nextResume = 0;
  for (const e of events) {
    if (!e.timestamp) continue;
    let startsNew = segments.length === 0;
    while (nextResume < resumeTimes.length && resumeTimes[nextResume] <= e.timestamp) {
      nextResume++;
      startsNew = true;
    }
    if (startsNew) segments.push({ start: e.timestamp, end: e.timestamp });
    else segments.at(-1).end = e.timestamp;
  }

  const uses = toolUses(events);
  const nameById = new Map(uses.map((u) => [u.id, u.name]));
  const errors = toolErrors(events, nameById);
  const handbacks = uses
    .filter((u) => u.name === 'SubagentHandback')
    .map((u) => String(u.input.message ?? ''));
  const finalText = handbacks.length
    ? handbacks
    : [textOf(events.filter((e) => e.type === 'assistant').at(-1)?.message?.content)].filter(Boolean);
  const firstWrite = uses.findIndex((u) => WRITE_TOOLS.has(u.name));
  const brief = all.find((e) => e.type === 'user' && typeof e.message?.content === 'string')?.message.content ?? '';
  const { total, byModel } = tokensOf(events);
  const reads = readsOf(uses);

  return {
    agentId,
    type: meta.agentType ?? 'unknown',
    description: meta.description ?? null,
    launchToolUseId: meta.toolUseId ?? null,
    models: Object.keys(byModel),
    start: segments[0]?.start ?? null,
    end: segments.at(-1)?.end ?? null,
    dispatches: segments.length,
    resumes: Math.max(segments.length - 1, 0),
    segments: segments.map((s) => ({ start: s.start, end: s.end, ms: msBetween(s.start, s.end) })),
    activeMs: segments.reduce((sum, s) => sum + msBetween(s.start, s.end), 0),
    briefChars: brief.length,
    tokens: total,
    tokensByModel: byModel,
    cacheHitRatio: cacheHitRatio(total),
    toolCalls: uses.length,
    toolCallsByName: countBy(uses, (u) => u.name),
    toolCallsBeforeFirstWrite: firstWrite === -1 ? null : firstWrite,
    skillsLoaded: uses.filter((u) => u.name === 'Skill').map((u) => u.input.skill),
    errors,
    errorsByKind: countBy(errors, (e) => e.kind),
    reads,
    repeatedReads: Object.fromEntries(Object.entries(reads).filter(([, n]) => n > 1)),
    statuses: finalText.map(statusOf),
    reports: finalText.map((r) => r.slice(0, 4000)),
    display: {
      active: formatDuration(segments.reduce((sum, s) => sum + msBetween(s.start, s.end), 0)),
      tokens: displayTokens(total),
    },
  };
}

function isHumanMessage(e) {
  if (e.type !== 'user' || e.isMeta || e.toolUseResult !== undefined) return false;
  const content = e.message?.content;
  if (Array.isArray(content) && content.some((c) => c.type === 'tool_result')) return false;
  const text = textOf(content).trim();
  return text !== '' && !HARNESS_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function maxConcurrency(agents) {
  const points = [];
  for (const a of agents) {
    for (const s of a.segments) {
      points.push([s.start, 1], [s.end, -1]);
    }
  }
  points.sort((x, y) => (x[0] === y[0] ? x[1] - y[1] : x[0] < y[0] ? -1 : 1));
  let now = 0;
  let max = 0;
  for (const [, d] of points) max = Math.max(max, (now += d));
  return max;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectDir = args['project-dir'] ? resolve(args['project-dir']) : projectDirFor(process.cwd());
  const sessionPath = resolveSession(args, projectDir);
  if (!existsSync(sessionPath)) fail(`session transcript not found: ${sessionPath}`);
  const prices = args.prices ? JSON.parse(readFileSync(args.prices, 'utf8')) : null;
  const window = { since: args.since ?? null, until: args.until ?? null };

  const sessionId = basename(sessionPath, '.jsonl');
  const events = readJsonl(sessionPath).filter((e) => inWindow(e.timestamp, window));
  const stamps = events.map((e) => e.timestamp).filter(Boolean).sort();
  const mainUses = toolUses(events);
  const mainNameById = new Map(mainUses.map((u) => [u.id, u.name]));
  const mainErrors = toolErrors(events, mainNameById);
  const mainTokens = tokensOf(events);

  const resumesById = new Map();
  for (const u of mainUses.filter((u) => u.name === 'SendMessage' && u.input.to)) {
    (resumesById.get(u.input.to) ?? resumesById.set(u.input.to, []).get(u.input.to)).push(u.ts);
  }

  const subDir = join(projectDir, sessionId, 'subagents');
  const agents = existsSync(subDir)
    ? readdirSync(subDir)
        .filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'))
        .map((f) => collectAgent(subDir, f, window, resumesById))
        .filter(Boolean)
        .sort((a, b) => (a.start < b.start ? -1 : 1))
    : [];
  agents.forEach((a, i) => (a.order = i + 1));

  const agentTokens = agents.reduce((sum, a) => addTokens(sum, a.tokens), emptyTokens());
  const total = addTokens(addTokens(emptyTokens(), mainTokens.total), agentTokens);
  const byModel = {};
  for (const src of [mainTokens.byModel, ...agents.map((a) => a.tokensByModel)]) {
    for (const [m, t] of Object.entries(src)) addTokens((byModel[m] ??= emptyTokens()), t);
  }

  // Files read by more than one actor (main session counts as an actor).
  const readers = {};
  for (const [file] of Object.entries(readsOf(mainUses))) (readers[file] ??= []).push('main');
  for (const a of agents) for (const file of Object.keys(a.reads)) (readers[file] ??= []).push(`${a.type}#${a.order}`);
  const sharedReads = Object.fromEntries(Object.entries(readers).filter(([, who]) => who.length > 1));

  const timeline = [];
  for (const a of agents) {
    a.segments.forEach((s, i) => {
      timeline.push({ ts: s.start, agent: `${a.type}#${a.order}`, event: i === 0 ? 'launch' : 'resume' });
      timeline.push({ ts: s.end, agent: `${a.type}#${a.order}`, event: 'stop', status: a.statuses[i] ?? null });
    });
  }
  timeline.sort((x, y) => (x.ts < y.ts ? -1 : 1));

  const turnDurations = events.filter((e) => e.type === 'system' && e.subtype === 'turn_duration');

  const result = {
    session: {
      id: sessionId,
      path: sessionPath,
      window,
      start: stamps[0] ?? null,
      end: stamps.at(-1) ?? null,
      wallMs: msBetween(stamps[0], stamps.at(-1)),
      mainActiveMs: turnDurations.reduce((sum, e) => sum + (e.durationMs ?? 0), 0),
      models: Object.keys(byModel),
    },
    tokens: {
      total,
      main: mainTokens.total,
      agents: agentTokens,
      byModel,
      cacheHitRatio: cacheHitRatio(total),
      agentShare: total.output + total.input + total.cacheRead + total.cacheWrite
        ? round(
            (agentTokens.input + agentTokens.output + agentTokens.cacheRead + agentTokens.cacheWrite) /
              (total.input + total.output + total.cacheRead + total.cacheWrite),
            3,
          )
        : null,
    },
    costUsd: costOf(byModel, prices),
    agents: {
      count: agents.length,
      byType: countBy(agents, (a) => a.type),
      dispatches: agents.reduce((sum, a) => sum + a.dispatches, 0),
      maxConcurrent: maxConcurrency(agents),
      list: agents,
    },
    timeline,
    main: {
      toolCalls: mainUses.length,
      toolCallsByName: countBy(mainUses, (u) => u.name),
      agentLaunches: mainUses.filter((u) => AGENT_LAUNCH_TOOLS.has(u.name)).length,
      agentMessages: mainUses.filter((u) => u.name === 'SendMessage').length,
      skillsLoaded: mainUses.filter((u) => u.name === 'Skill').map((u) => u.input.skill),
      errors: mainErrors,
      errorsByKind: countBy(mainErrors, (e) => e.kind),
      repeatedReads: Object.fromEntries(Object.entries(readsOf(mainUses)).filter(([, n]) => n > 1)),
    },
    human: {
      messages: events.filter(isHumanMessage).length,
      questionsAsked: mainUses
        .filter((u) => u.name === 'AskUserQuestion')
        .reduce((sum, u) => sum + (u.input.questions?.length ?? 0), 0),
      questionCalls: mainUses.filter((u) => u.name === 'AskUserQuestion').length,
      rejectedToolCalls: mainErrors.filter((e) => e.kind === 'rejected_by_user').length,
    },
    sharedReads,
    // Pre-formatted strings for the report; metrics.csv keeps the raw numbers above.
    display: {
      wall: formatDuration(msBetween(stamps[0], stamps.at(-1))),
      mainActive: formatDuration(turnDurations.reduce((sum, e) => sum + (e.durationMs ?? 0), 0)),
      tokens: {
        total: displayTokens(total),
        main: displayTokens(mainTokens.total),
        agents: displayTokens(agentTokens),
      },
    },
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();

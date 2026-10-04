#!/usr/bin/env node
// Deterministic lint for an Implementation Plan (docs/plans/*.md).
//   node scripts/lint-plan.mjs <plan.md> [--spec <spec.md>] [--all]
// A plan whose Status is `done` is skipped unless --all is given.
// The spec is --spec, or the SPEC-NN-slug the plan cites (looked up by Spec ID).
// Exit 1 when there is an ERROR; WARN lines never fail the run.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--spec');
if (!file) {
  console.error('usage: node scripts/lint-plan.mjs <plan.md> [--spec <spec.md>] [--all]');
  process.exit(2);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const text = readFileSync(file, 'utf8');
const lines = text.split('\n');
const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const DO_NOT_TOUCH = [
  'server/src/db/migrations/', // allowed only as the output of db:generate (checked below)
  'server/clones/',
  'client/.next/',
  'client/.next-e2e/',
  'client/src/vendor/ui/',
  'e2e/test-results/',
];
const PAUSED_AGENTS = ['test-writer'];
const AGENTS = ['implementer', 'doc-writer', ...PAUSED_AGENTS];
const RULES_MIN = 5;
const RULES_MAX = 15;

// ---- status --------------------------------------------------------------
// The first `Status:` token in the file is the plan's (the run-plan log never
// writes a line that starts with it).
const status = /\bStatus:\s*`?([a-z]+)/.exec(text)?.[1];
if (!['draft', 'approved', 'done'].includes(status)) {
  err(`Status must be draft | approved | done (got ${status ?? 'none'})`);
}
if (status === 'done' && !flag('--all')) {
  console.log(`${basename(file)}: Status done — skipped (pass --all to lint it anyway)`);
  process.exit(0);
}

// ---- parse tasks ---------------------------------------------------------
// A task is a `#### T001 …` heading; its wave is the nearest `### Wave N`
// heading above it (any other `###` heading means "not in a wave").
const tasks = [];
let wave = null;
let current = null;
let field = null;
for (const [n, line] of lines.entries()) {
  if (/^## /.test(line)) {
    wave = null;
    current = null;
    field = null;
    continue;
  }
  const waveHeading = /^### (.*)$/.exec(line);
  if (waveHeading) {
    const w = /^Wave (\d+)\b/i.exec(waveHeading[1]);
    wave = w ? Number(w[1]) : null;
    current = null;
    field = null;
    continue;
  }
  const taskHeading = /^#### (T\d{3})\b(.*)$/.exec(line);
  if (taskHeading) {
    current = {
      id: taskHeading[1],
      parallel: /\[P\]/.test(taskHeading[2]),
      wave,
      line: n + 1,
      fields: {},
      body: '',
    };
    tasks.push(current);
    field = null;
    continue;
  }
  if (!current) continue;
  current.body += `${line}\n`;
  const top = /^- ([A-Z][A-Za-z ]+?)(?: \([^)]*\))?:\s*(.*)$/.exec(line);
  if (top) {
    field = top[1].trim();
    current.fields[field] = { inline: top[2], items: [] };
    continue;
  }
  const item = /^ {2}- (.*)$/.exec(line); // deeper bullets continue the item
  if (item && field) {
    current.fields[field].items.push(item[1]);
  } else if (/^\s{4,}\S/.test(line) && field && current.fields[field].items.length) {
    const items = current.fields[field].items;
    items[items.length - 1] += ` ${line.trim()}`; // wrapped item
  }
}
if (tasks.length === 0) err('no tasks found (expected "#### T001 — …" headings under "### Wave N")');

const byId = new Map(tasks.map((t) => [t.id, t]));
const filesOf = (t) =>
  (t.fields.Files?.items ?? [])
    // The first backticked token that looks like a path, not a symbol.
    .map((it) => ({ path: [...it.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]).find((p) => /\/|\.\w+$/.test(p)), text: it }))
    .filter((f) => f.path);

// ---- per task ----------------------------------------------------------
for (const t of tasks) {
  const where = `${t.id} (line ${t.line})`;
  const agent = (t.fields.Agent?.inline || 'implementer').replace(/`/g, '').split(/[\s(]/)[0];

  if (!AGENTS.includes(agent)) err(`${where}: unknown Agent "${agent}"`);
  if (PAUSED_AGENTS.includes(agent)) {
    err(`${where}: Agent ${agent} is paused — make it an implementer task that writes the tests`);
  }
  if (t.wave === null) warn(`${where}: not under a "### Wave N" heading — run-plan will not dispatch it`);

  for (const required of ['Area', 'Files', 'Acceptance criteria', 'Verify']) {
    const f = t.fields[required];
    if (!f || (!f.inline && f.items.length === 0)) err(`${where}: missing "- ${required}:"`);
  }

  if (agent !== 'doc-writer') {
    const rules = t.fields.Rules?.items ?? [];
    if (rules.length === 0) {
      err(`${where}: missing "- Rules:" (${RULES_MIN}–${RULES_MAX} rules, each "— <skill> §<section>")`);
    } else {
      if (rules.length < RULES_MIN || rules.length > RULES_MAX) {
        err(`${where}: Rules has ${rules.length} lines, expected ${RULES_MIN}–${RULES_MAX}${rules.length > RULES_MAX ? ' (split the task)' : ''}`);
      }
      rules.forEach((r, i) => {
        if (!/§/.test(r)) err(`${where}: Rules line ${i + 1} names no source section ("— <skill> §<section>"): ${r.slice(0, 80)}`);
      });
    }
    const verify = `${t.fields.Verify?.inline ?? ''} ${(t.fields.Verify?.items ?? []).join(' ')}`;
    if (!/verify-task\.sh/.test(verify)) warn(`${where}: Verify has no scripts/verify-task.sh line`);
  }

  for (const f of filesOf(t)) {
    const isNew = /\((new|generated)\b/.test(f.text);
    const pattern = /[{}*]/.test(f.path);
    if (/^…|^\.\.\.|\/…\//.test(f.path)) {
      err(`${where}: ${f.path} is abbreviated — write the full repo-relative path`);
      continue;
    }
    if (!isNew && !pattern && !existsSync(join(ROOT, f.path))) {
      err(`${where}: ${f.path} does not exist and is not marked (new)`);
    }
    const blocked = DO_NOT_TOUCH.find((p) => f.path.startsWith(p));
    if (blocked) {
      const generated = blocked === 'server/src/db/migrations/' && /generated|db:generate/.test(f.text);
      if (!generated) err(`${where}: ${f.path} is a do-not-touch path`);
    }
  }

  const deps = (t.fields['Depends on']?.inline ?? '').match(/\bT\d{3}\b/g) ?? [];
  for (const d of deps) {
    const dep = byId.get(d);
    if (!dep) err(`${where}: depends on ${d}, which is not a task of this plan`);
    else if (t.wave !== null && dep.wave !== null && dep.wave > t.wave) {
      err(`${where}: depends on ${d} from a later wave (W${dep.wave} > W${t.wave})`);
    } else if (t.wave !== null && dep.wave === t.wave && t.parallel) {
      err(`${where}: [P] task depends on ${d} in the same wave`);
    }
  }
}

// ---- file ownership per wave --------------------------------------------
const owners = new Map(); // `${wave}:${path}` → task id
for (const t of tasks) {
  for (const f of filesOf(t)) {
    const key = `${t.wave}:${f.path}`;
    if (owners.has(key)) err(`${f.path} is owned by ${owners.get(key)} and ${t.id} in the same wave (W${t.wave})`);
    else owners.set(key, t.id);
  }
}
const ownership = /## Ownership check\n([\s\S]*?)(\n## |$)/.exec(text)?.[1];
if (!ownership) warn('no "## Ownership check" table');
else {
  for (const t of tasks) {
    for (const f of filesOf(t)) {
      if (!ownership.includes(f.path) && !ownership.includes(basename(f.path).replace(/\.\w+$/, ''))) {
        warn(`Ownership check does not list ${f.path} (${t.id})`);
      }
    }
  }
}

// ---- spec coverage -------------------------------------------------------
const specDirs = ['specs', 'server/specs', 'client/specs', 'reviewer-core/specs', 'e2e/docs'];
let specPath = option('--spec');
if (!specPath) {
  const cited = /\bSPEC-\d{2}-[a-z0-9-]+\b/.exec(text)?.[0];
  if (cited) {
    for (const dir of specDirs) {
      const abs = join(ROOT, dir);
      if (!existsSync(abs)) continue;
      const hit = readdirSync(abs)
        .filter((n) => n.endsWith('.md'))
        .find((n) => new RegExp(`^Spec ID: ${cited}$`, 'm').test(readFileSync(join(abs, n), 'utf8')));
      if (hit) specPath = join(dir, hit);
    }
    if (!specPath) err(`plan cites ${cited}, but no spec file has that Spec ID`);
  }
}
let acCount = 0;
if (specPath) {
  const spec = readFileSync(resolve(ROOT, specPath), 'utf8');
  const specStatus = /^Status: (\S+)/m.exec(spec)?.[1];
  const oq = (/## Open questions\n([\s\S]*?)(\n## |$)/.exec(spec)?.[1] ?? '').match(/^- OQ\d+/gm) ?? [];
  if (specStatus === 'draft' && oq.length) err(`spec ${basename(specPath)} is draft with ${oq.length} open question(s) — finish it with spec-creator first`);
  else if (specStatus !== 'approved') warn(`spec ${basename(specPath)} is ${specStatus}, not approved`);

  const specAcs = [...spec.matchAll(/^- (AC\d+)\b/gm)].map((m) => m[1]);
  acCount = specAcs.length;
  const taskText = tasks.map((t) => t.body).join('\n');
  for (const ac of specAcs) {
    if (!new RegExp(`\\b${ac}\\b`).test(taskText)) err(`${ac} of the spec is not covered by any task`);
  }
  for (const ac of new Set(text.match(/\bAC\d+\b/g) ?? [])) {
    if (!specAcs.includes(ac)) err(`${ac} is cited by the plan but not defined in the spec`);
  }
}

// ---- report ------------------------------------------------------------
warns.forEach((w) => console.log(`WARN  ${w}`));
errors.forEach((e) => console.log(`ERROR ${e}`));
const waves = new Set(tasks.map((t) => t.wave).filter((w) => w !== null)).size;
console.log(
  `${basename(file)}: ${tasks.length} task(s) · ${waves} wave(s)` +
    `${specPath ? ` · spec ${basename(specPath)} (${acCount} AC)` : ' · no spec'}` +
    ` — ${errors.length} error(s), ${warns.length} warning(s)`,
);
process.exit(errors.length ? 1 : 0);

#!/usr/bin/env node
// PreToolUse guard for the spec-creator agent.
//
//   Bash   → only an allow-list of read-only commands, no redirects or pipes
//            into writers.
//   Write  → only a NEW spec file (or a new README.md index) in a spec folder.
//   Edit   → an existing draft spec with a Spec ID; the "## Index" section of
//            specs/README.md; append-only edits to a package specs/README.md
//            and to the "## Read when" section of <pkg>/CLAUDE.md.
//   Status → an edit of ONLY a `Status:` line asks the user for permission.
//
// Exit 2 blocks; stdout JSON with permissionDecision "ask" prompts the user.
import { existsSync, readFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';

const SPEC_DIR = /^(specs|server\/specs|client\/specs|reviewer-core\/specs|e2e\/docs)\//;
const SPEC_NAME = /^\d{2}-[a-z0-9]+(-[a-z0-9]+){0,2}-\d{4}-\d{2}-\d{2}\.md$/;
const PKG_CLAUDE = /^(server|client|reviewer-core|e2e)\/CLAUDE\.md$/;
const STATUS_ONLY = /^Status: \S+$/;

const BASH_ALLOWED = [
  /^(ls|wc|head|cat)( [^;&|<>`$]*)?$/,
  /^grep( [^;&|<>`$]*)?$/,
  /^git (log|diff|show|status|branch --show-current)( [^;&|<>`$]*)?$/,
  /^date \+%F$/,
  /^node scripts\/lint-spec\.mjs [\w./-]+$/,
];

const deny = (msg) => {
  console.error(`spec-creator blocked: ${msg}`);
  process.exit(2);
};
const ask = (reason) => {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
};
// [start, end) of a "## <title>" section, or null.
const sectionRange = (text, title) => {
  const m = new RegExp(`^## ${title}\\s*$`, 'm').exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/^## /m);
  return [m.index, next === -1 ? text.length : m.index + m[0].length + next];
};
const inside = (text, needle, range) => {
  const at = text.indexOf(needle);
  return needle !== '' && range && at >= range[0] && at + needle.length <= range[1];
};

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

const input = JSON.parse(raw || '{}');
const tool = input.tool_name;
const args = input.tool_input ?? {};

if (tool === 'Bash') {
  const cmd = String(args.command ?? '').trim();
  if (!BASH_ALLOWED.some((re) => re.test(cmd))) {
    deny(
      `Bash is read-only for this agent. Allowed: ls, wc, head, cat, grep, ` +
        `git log|diff|show|status, date +%F, node scripts/lint-spec.mjs <spec> — ` +
        `one command, no pipes, redirects, ";" or "&&". Got: ${cmd.slice(0, 120)}`,
    );
  }
  process.exit(0);
}

if (typeof args.file_path !== 'string') process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const abs = resolve(root, args.file_path);
const rel = relative(root, abs).split('\\').join('/');
const name = basename(rel);
const exists = existsSync(abs);
const current = exists ? readFileSync(abs, 'utf8') : '';

const inSpecDir = SPEC_DIR.test(rel) && rel.split('/').length === (rel.startsWith('specs/') ? 2 : 3);
const isReadme = name === 'README.md';
const isRootIndex = rel === 'specs/README.md';
const isPkgClaude = PKG_CLAUDE.test(rel);

if (!inSpecDir && !isPkgClaude) {
  deny(
    `${rel} is outside the write scope (specs/*.md, <pkg>/specs/*.md, e2e/docs/*.md, ` +
      `<pkg>/CLAUDE.md › Read when).`,
  );
}

if (tool === 'Write') {
  if (exists) deny(`${rel} already exists — Write may only create new files; use Edit.`);
  if (isPkgClaude) deny(`${rel} must be edited, never created or overwritten.`);
  if (!isReadme && !SPEC_NAME.test(name)) {
    deny(`new spec files must be named <NN>-<slug>-<YYYY-MM-DD>.md (got ${name}).`);
  }
  const status = /^Status:\s*(\S+)/m.exec(args.content ?? '')?.[1];
  if (!isReadme && status !== 'draft') {
    ask(`New spec ${name} sets Status: ${status ?? '(missing)'} instead of draft. Allow?`);
  }
  process.exit(0);
}

if (tool !== 'Edit') deny(`${tool} is not allowed on ${rel}.`);
if (!exists) deny(`${rel} does not exist — Edit needs an existing file.`);
const oldS = args.old_string ?? '';
const newS = args.new_string ?? '';
const appendOnly = oldS !== '' && newS.startsWith(oldS);

if (isPkgClaude) {
  if (!inside(current, oldS, sectionRange(current, 'Read when')) || !appendOnly) {
    deny(`only appending inside the "## Read when" section of ${rel} is allowed.`);
  }
  process.exit(0);
}

if (isRootIndex) {
  if (!inside(current, oldS, sectionRange(current, 'Index'))) {
    deny('only the "## Index" section of specs/README.md may be edited.');
  }
  process.exit(0);
}

if (isReadme) {
  // Package index: append a bullet, or change a bullet that links a numbered spec.
  const specBullets = oldS
    .split('\n')
    .filter((l) => l.trim())
    .every((l) => /^\s*- .*\(\d{2}-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.md\)/.test(l) || /^\s{2,}\S/.test(l));
  if (!appendOnly && !specBullets) {
    deny(`${rel}: only append a bullet or change the bullet of a numbered spec.`);
  }
  process.exit(0);
}

// A spec file. Specs without a Spec ID were written by others: read-only.
if (!/^Spec ID: SPEC-\d{2}-/m.test(current)) {
  deny(`${rel} has no "Spec ID" — it is an existing spec and is never edited.`);
}
// A status change = the Status value differs between old_string and new_string.
// Keeping the same "Status: draft" line as an anchor is an ordinary edit.
const valueOf = (s) => /^Status:\s*(\S+)/m.exec(s)?.[1];
const touchesStatus = valueOf(oldS) !== valueOf(newS);
if (touchesStatus) {
  if (!STATUS_ONLY.test(oldS.trim()) || !STATUS_ONLY.test(newS.trim())) {
    deny('a Status change must be its own Edit: old_string and new_string are one "Status: <value>" line each.');
  }
  const target = newS.trim().slice('Status: '.length);
  const openQs = (current.match(/^- OQ\d+\b/gm) ?? []).length;
  if (target === 'approved' && openQs > 0) {
    deny(`${name} still has ${openQs} open question(s); resolve them before proposing approved.`);
  }
  ask(`Change the Status of ${name}: "${oldS.trim()}" → "${newS.trim()}"?`);
}
const status = /^Status:\s*(\S+)/m.exec(current)?.[1];
if (status !== 'draft') {
  deny(`${name} is ${status}: only a draft may be edited. Write a new spec with Supersedes instead.`);
}
process.exit(0);

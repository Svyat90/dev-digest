#!/usr/bin/env node
// PreToolUse guard for the spec-creator agent.
//
//   Write  → only a NEW spec file (or a new README.md index) in a spec folder.
//   Edit   → only an existing spec the agent may touch (see below), a README.md
//            index, or the "## Read when" section of <pkg>/CLAUDE.md.
//   Status → any change to a `Status:` line asks the user for permission.
//
// Exit 2 blocks; stdout JSON with permissionDecision "ask" prompts the user.
import { existsSync, readFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';

const SPEC_DIR = /^(specs|server\/specs|client\/specs|reviewer-core\/specs|e2e\/docs)\//;
const SPEC_NAME = /^\d{2}-[a-z0-9]+(-[a-z0-9]+){0,2}-\d{4}-\d{2}-\d{2}\.md$/;
const PKG_CLAUDE = /^(server|client|reviewer-core|e2e)\/CLAUDE\.md$/;
const STATUS_LINE = /^Status:/m;

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

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

const input = JSON.parse(raw || '{}');
const tool = input.tool_name;
const args = input.tool_input ?? {};
if (typeof args.file_path !== 'string') process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const abs = resolve(root, args.file_path);
const rel = relative(root, abs).split('\\').join('/');
const name = basename(rel);
const exists = existsSync(abs);
const current = exists ? readFileSync(abs, 'utf8') : '';

const inSpecDir = SPEC_DIR.test(rel) && rel.split('/').length === (rel.startsWith('specs/') ? 2 : 3);
const isReadme = name === 'README.md';
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

// Edit
if (!exists) deny(`${rel} does not exist — Edit needs an existing file.`);
const oldS = args.old_string ?? '';
const newS = args.new_string ?? '';

if (isPkgClaude) {
  const start = current.search(/^## Read when\s*$/m);
  if (start === -1) deny(`${rel} has no "## Read when" section to edit.`);
  const rest = current.slice(start + 1);
  const next = rest.search(/^## /m);
  const end = next === -1 ? current.length : start + 1 + next;
  const at = current.indexOf(oldS);
  if (oldS === '' || at < start || at + oldS.length > end) {
    deny(`only the "## Read when" section of ${rel} may be edited.`);
  }
  process.exit(0);
}

if (isReadme) process.exit(0);

// A spec file. Specs without a Spec ID were written by others: read-only.
if (!/^Spec ID: SPEC-\d{2}-/m.test(current)) {
  deny(`${rel} has no "Spec ID" — it is an existing spec and is never edited.`);
}
const touchesStatus = STATUS_LINE.test(oldS) || STATUS_LINE.test(newS);
if (touchesStatus) {
  ask(`Change the Status of ${name}? ("${oldS.trim()}" → "${newS.trim()}")`);
}
const status = /^Status:\s*(\S+)/m.exec(current)?.[1];
if (status !== 'draft') {
  deny(`${name} is ${status}: only a draft may be edited. Write a new spec with Supersedes instead.`);
}
process.exit(0);

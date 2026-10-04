#!/usr/bin/env node
// PreToolUse guard for the implementation-planner agent.
//
//   Write → only docs/plans/<YYYY-MM-DD>-<kebab-topic>.md: a new plan, or an
//           existing plan whose `Status:` is `draft` (a revision).
//   Edit  → never; the agent has no Edit tool, this is a backstop.
//
// Bash writes are invisible to this hook; the agent file forbids them.
// Exit 2 blocks.
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const PLAN_PATH = /^docs\/plans\/\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*\.md$/;

const deny = (msg) => {
  console.error(`implementation-planner blocked: ${msg}`);
  process.exit(2);
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

if (tool === 'Edit') deny(`Edit is not allowed (${rel}); rewrite the plan with Write.`);

if (!PLAN_PATH.test(rel)) {
  deny(`${rel} is outside the write scope (docs/plans/<YYYY-MM-DD>-<kebab-topic>.md).`);
}

if (existsSync(abs)) {
  const status = /^.*\bStatus:\s*(\S+)/m.exec(readFileSync(abs, 'utf8'))?.[1];
  if (status !== 'draft') {
    deny(`${rel} is ${status ?? 'missing a Status'}: only a draft plan may be rewritten.`);
  }
}
process.exit(0);

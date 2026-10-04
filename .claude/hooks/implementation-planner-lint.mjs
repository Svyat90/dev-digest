#!/usr/bin/env node
// PostToolUse hook for the implementation-planner agent: lint every plan file
// right after Write. Lint errors go back to the agent (exit 2) so it fixes them.
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

const filePath = JSON.parse(raw || '{}').tool_input?.file_path;
if (typeof filePath !== 'string') process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const abs = resolve(root, filePath);
const rel = relative(root, abs).split('\\').join('/');
if (!/^docs\/plans\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/.test(rel)) process.exit(0);

const run = spawnSync('node', [resolve(root, 'scripts/lint-plan.mjs'), abs], {
  cwd: root,
  encoding: 'utf8',
});
if (run.status === 0) process.exit(0);

console.error(`lint-plan failed — fix these before reporting:\n${run.stdout}${run.stderr}`);
process.exit(2);

#!/usr/bin/env node
// PostToolUse hook for the spec-creator agent: lint every spec file right after
// Write/Edit. Lint errors go back to the agent (exit 2) so it fixes them.
import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

const filePath = JSON.parse(raw || '{}').tool_input?.file_path;
if (typeof filePath !== 'string') process.exit(0);
if (!/^\d{2}-.+-\d{4}-\d{2}-\d{2}\.md$/.test(basename(filePath))) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const run = spawnSync('node', [resolve(root, 'scripts/lint-spec.mjs'), resolve(root, filePath)], {
  cwd: root,
  encoding: 'utf8',
});
if (run.status === 0) process.exit(0);

console.error(`lint-spec failed — fix these before reporting:\n${run.stdout}${run.stderr}`);
process.exit(2);

#!/usr/bin/env bash
#
# L06 gate: typecheck + tests of reviewer-core, server and client, plus the
# eval-pipeline integration test (scripted model, no real model call).
#
#   pnpm verify:l06        (from the repository root; needs Docker)
#
# Exit 0 only when every step passes; stops at the first failure. Needs
# Docker because the server integration suite runs against Testcontainers
# Postgres; EVAL_IT_REQUIRED=1 makes the eval tests fail instead of skip.

set -euo pipefail
set -f   # no pathname expansion: vitest globs are passed literally

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! docker info >/dev/null 2>&1; then
  echo "FAIL setup — Docker is not reachable; verify:l06 runs the server integration suite against Postgres" >&2
  exit 1
fi

for pkg in reviewer-core server client; do
  if [ ! -d "$ROOT/$pkg/node_modules" ]; then
    echo "FAIL setup — $pkg/node_modules is missing; install that package's dependencies first" >&2
    exit 1
  fi
done

step() {
  local label="$1" dir="$2"
  shift 2
  if (cd "$ROOT/$dir" && "$@"); then
    echo "PASS $label"
  else
    echo "FAIL $label" >&2
    exit 1
  fi
}

step "reviewer-core typecheck" reviewer-core npm run --silent typecheck
step "reviewer-core tests" reviewer-core npm test --silent

step "server typecheck" server pnpm run typecheck
step "server unit tests" server ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts'
step "server integration tests (incl. eval-pipeline)" server \
  env EVAL_IT_REQUIRED=1 TESTCONTAINERS_RYUK_DISABLED=true ./node_modules/.bin/vitest run .it.test

step "client typecheck" client pnpm run typecheck
step "client tests" client ./node_modules/.bin/vitest run

echo "PASS verify:l06"

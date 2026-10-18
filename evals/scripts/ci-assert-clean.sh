#!/usr/bin/env bash
# Fails (and prints the damage) when a model-backed eval run changed tracked or untracked files.
#
# Eval sessions run with bypassPermissions, where allowedTools only pre-approves: write tools are
# denied via disallowedTools in src/runtime/run-claude.ts, and this is the check that the denial
# held. evals/results/ is git-ignored, so the run's own records never trip it.
# Run from the repo root.

set -euo pipefail

dirty="$(git status --porcelain)"
if [[ -n "$dirty" ]]; then
  echo "::error title=harness evals · repo modified::an eval session wrote to the checkout"
  echo "$dirty"
  git --no-pager diff --stat
  exit 1
fi
echo "checkout clean after the eval run"

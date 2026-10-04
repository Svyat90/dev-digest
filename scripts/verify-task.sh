#!/usr/bin/env bash
#
# Verify one plan task (or one wave) with as little output as possible.
#
#   scripts/verify-task.sh <pkg> [--it] <files…>   # task mode: only errors in <files> count
#   scripts/verify-task.sh <pkg> --gate [--it]     # wave gate: every error counts
#
#   <pkg>   server | client | reviewer-core | mcp
#   <files> the task's files, repo-relative (client/src/x.ts) or package-relative
#   --it    also run *.it.test.ts (needs Postgres); skipped by default
#
# Steps: typecheck, vitest (task mode: only the test files among <files>;
# gate: the package suite), arch:check (server only). One line per step:
#   PASS <step> · FAIL <step> — own N · foreign M · SKIP <step> — <why>
# A failing step prints its first 40 own lines and how to re-run it in full.
# Errors in files outside <files> (another task of a parallel wave) are only
# counted, never fail the run. Exit 0 = no own errors, 1 = own errors, 2 = usage.
#
# bash 3.2 compatible (macOS /bin/bash): no mapfile, no associative arrays.

set -uo pipefail
set -f   # no pathname expansion: file lists and vitest globs are passed literally

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIMIT=40

usage() { sed -n '3,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 2; }

[ $# -ge 1 ] || usage
PKG="$1"; shift
case "$PKG" in
  server|client) RUN="pnpm run" ;;
  reviewer-core|mcp) RUN="npm run --silent" ;;
  *) echo "unknown package: $PKG" >&2; usage ;;
esac
[ -d "$ROOT/$PKG/node_modules" ] || { echo "FAIL setup — $PKG/node_modules missing (install it first)"; exit 1; }

GATE=0; IT=0; FILES=""
for a in "$@"; do
  case "$a" in
    --gate) GATE=1 ;;
    --it) IT=1 ;;
    -*) echo "unknown flag: $a" >&2; usage ;;
    *) FILES="$FILES ${a#"$PKG"/}" ;;   # normalize to package-relative
  esac
done
[ "$GATE" = 1 ] || [ -n "$FILES" ] || { echo "task mode needs the task's files (or pass --gate)" >&2; usage; }

cd "$ROOT/$PKG" || exit 2
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
OWN_FAIL=0

# is_own <path> → 0 when the path is one of FILES (always 0 in gate mode)
is_own() {
  [ "$GATE" = 1 ] && return 0
  local f
  for f in $FILES; do
    [ "$1" = "$f" ] && return 0
  done
  return 1
}

# split_diagnostics <raw> <start-regex> <owner-sed>: a line matching the regex
# starts a diagnostic, indented lines continue it. <owner-sed> turns the first
# line into the path that owns the diagnostic (the file with the type error,
# the importing file of a dependency violation) — never a path merely named in
# the message. Writes own.txt / foreign.txt / foreign-files.txt.
split_diagnostics() {
  : > "$TMP/own.txt"; : > "$TMP/foreign.txt"; : > "$TMP/foreign-files.txt"
  local line block="" owner owner_sed="$3"
  flush() {
    [ -n "$block" ] || return 0
    owner="$(printf '%s\n' "$block" | head -1 | sed -E "$owner_sed")"
    if is_own "$owner"; then printf '%s\n' "$block" >> "$TMP/own.txt"
    else printf '%s\n' "$block" >> "$TMP/foreign.txt"
         printf '%s\n' "$owner" >> "$TMP/foreign-files.txt"
    fi
    block=""
  }
  while IFS= read -r line; do
    if printf '%s\n' "$line" | grep -qE "$2"; then flush; block="$line"
    elif [ -n "$block" ] && printf '%s\n' "$line" | grep -qE '^[[:space:]]+[^[:space:]]'; then block="$block
$line"
    else flush
    fi
  done < "$1"
  flush
}

report() { # report <step> <own-count> <foreign-count> <rerun hint>
  local step="$1" own="$2" foreign="$3" hint="$4" files
  if [ "$own" -gt 0 ]; then
    echo "FAIL $step — own $own · foreign $foreign"
    head -n "$LIMIT" "$TMP/own.txt" | sed 's/^/  /'
    [ "$(wc -l < "$TMP/own.txt")" -gt "$LIMIT" ] && echo "  … truncated; full output: $hint"
    OWN_FAIL=1
  elif [ "$foreign" -gt 0 ]; then
    files="$(sort -u "$TMP/foreign-files.txt" | head -10 | paste -sd, - | sed 's/,/, /g')"
    echo "PASS $step — own 0 · foreign $foreign (${files:-?})"
  else
    echo "PASS $step"
  fi
}

# --- typecheck -------------------------------------------------------------
$RUN typecheck > "$TMP/tsc.txt" 2>&1; TSC_EXIT=$?
split_diagnostics "$TMP/tsc.txt" '^[^[:space:]].*\([0-9]+,[0-9]+\): error TS' 's/\([0-9]+,[0-9]+\): error TS.*$//'
own=$(grep -c 'error TS' "$TMP/own.txt"); foreign=$(grep -c 'error TS' "$TMP/foreign.txt")
if [ "$TSC_EXIT" != 0 ] && [ "$own" = 0 ] && [ "$foreign" = 0 ]; then   # failed without a parsable error
  grep -vE '^(\$|>) ' "$TMP/tsc.txt" | head -n "$LIMIT" > "$TMP/own.txt"; own=1
fi
report typecheck "$own" "$foreign" "cd $PKG && $RUN typecheck"

# --- tests -------------------------------------------------------------------
VITEST="./node_modules/.bin/vitest"
TESTS=""
if [ "$GATE" = 1 ]; then
  if [ "$PKG" = server ] && [ "$IT" = 0 ]; then TESTS="--exclude **/*.it.test.ts"; fi
  TEST_DESC="suite"
else
  for f in $FILES; do
    case "$f" in
      *.it.test.ts) [ "$IT" = 1 ] && TESTS="$TESTS $f" ;;
      *.test.ts|*.test.tsx) TESTS="$TESTS $f" ;;
    esac
  done
  TEST_DESC="task tests"
fi
if [ "$GATE" = 0 ] && [ -z "$TESTS" ]; then
  echo "SKIP tests — no test files among the task's files"
else
  # shellcheck disable=SC2086  # word-splitting of the file list is intended
  if "$VITEST" run $TESTS --passWithNoTests --reporter=dot --silent > "$TMP/test.txt" 2>&1; then
    echo "PASS tests ($TEST_DESC) — $(grep -E '^ +Tests ' "$TMP/test.txt" | sed 's/^ *Tests *//')"
  else
    echo "FAIL tests ($TEST_DESC) — $(grep -E '^ +Tests ' "$TMP/test.txt" | sed 's/^ *Tests *//')"
    # The failure itself: from vitest's first "Failed Suites" / "Failed Tests"
    # banner on, minus node_modules stack frames; else (a
    # collection or setup error) every line that is not a pass or known noise.
    esc="$(printf '\033')"   # BSD sed has no \x escapes
    sed "s/${esc}\[[0-9;]*m//g" "$TMP/test.txt" > "$TMP/test-plain.txt"
    if grep -qE 'Failed (Suites|Tests) [0-9]' "$TMP/test-plain.txt"; then
      sed -nE '/Failed (Suites|Tests) [0-9]/,$p' "$TMP/test-plain.txt" | grep -vE '^ +(Start at|Duration) |^[[:space:]]*$|❯ .*node_modules/'
    else
      grep -vE '^ *(✓|RUN )|CJS build of Vite|DeprecationWarning|trace-deprecation|^[[:space:]]*$' "$TMP/test-plain.txt"
    fi | head -n "$LIMIT" | sed 's/^/  /'
    echo "  full output for one file: cd $PKG && $VITEST run <file>"
    OWN_FAIL=1
  fi
fi

# --- arch:check (server only) ------------------------------------------------
if [ "$PKG" = server ]; then
  if pnpm run arch:check > "$TMP/arch.txt" 2>&1; then
    echo "PASS arch:check"
  else
    split_diagnostics "$TMP/arch.txt" '^[[:space:]]*(error|warn) ' 's/^[[:space:]]*(error|warn) [^:]+: ([^ ]+).*$/\2/'
    own=$(grep -cE '^[[:space:]]*(error|warn) ' "$TMP/own.txt")
    foreign=$(grep -cE '^[[:space:]]*(error|warn) ' "$TMP/foreign.txt")
    if [ "$own" = 0 ] && [ "$foreign" = 0 ]; then   # failed without a parsable violation
      grep -v '^\$' "$TMP/arch.txt" | head -n "$LIMIT" > "$TMP/own.txt"; own=1
    fi
    report arch:check "$own" "$foreign" "cd server && pnpm run arch:check"
  fi
fi

exit "$OWN_FAIL"

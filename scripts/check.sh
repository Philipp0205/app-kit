#!/usr/bin/env bash
# Repo checks: syntax of the JS and shell files, shellcheck if present, then the tests.
# No dependencies. Stays green on an empty tree.
set -euo pipefail

cd "$(dirname "$0")/.."

# Syntax check of the frontend scripts.
if [ -d frontend ]; then
  find frontend -type f -name '*.js' -print0 | while IFS= read -r -d '' file; do
    node --check "$file"
  done
fi

# Syntax check of the shell scripts.
for script in scripts/*.sh; do
  [ -e "$script" ] || continue
  bash -n "$script"
done

# shellcheck is optional.
if command -v shellcheck >/dev/null 2>&1; then
  for script in scripts/*.sh; do
    [ -e "$script" ] || continue
    shellcheck "$script"
  done
else
  echo "check.sh: shellcheck not found, skipping it" >&2
fi

# Unit tests (node:test, no dependencies).
if [ -d tests ]; then
  node --test tests/*.test.mjs
fi

echo "check.sh: ok"

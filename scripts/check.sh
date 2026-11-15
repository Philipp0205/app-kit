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

# Unit tests (node:test, no dependencies). The server tests are .ts files that
# run on Node's type stripping (Node >= 22.18 or 24). They import every server
# module, which is also the check that the .ts files load.
if [ -d tests ]; then
  node --test tests/*.test.mjs tests/server/*.test.ts
fi

echo "check.sh: ok"

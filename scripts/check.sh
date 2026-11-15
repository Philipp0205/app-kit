#!/usr/bin/env bash
# Repo checks. Stays green on an empty tree (no frontend/ yet).
set -euo pipefail

cd "$(dirname "$0")/.."

if command -v shellcheck >/dev/null 2>&1; then
  find scripts -type f -name '*.sh' -exec shellcheck {} +
fi

if [ -d frontend ]; then
  find frontend -type f -name '*.js' -exec node --check {} \;
fi

# Agent rules

- Keep the frontend helpers dependency-free: plain JS and CSS, no build step.
- Every release is a semver git tag and a CHANGELOG.md entry.
- A breaking change is a major version and needs a migration note in the changelog.
- Run `scripts/check.sh` before claiming done. It runs syntax checks, shellcheck (if installed), and the `node --test` tests in `tests/`.
- `server/` is TypeScript with `node:` built-ins only and erasable syntax only (Node type stripping: no enums, namespaces or constructor parameter properties, relative imports end in `.ts`). Its tests, `tests/server/*.test.ts`, run through `scripts/check.sh`.

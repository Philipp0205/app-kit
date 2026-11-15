# Agent rules

- Keep the frontend helpers dependency-free: plain JS and CSS, no build step.
- Every release is a semver git tag and a CHANGELOG.md entry.
- A breaking change is a major version and needs a migration note in the changelog.
- Run `scripts/check.sh` before claiming done.

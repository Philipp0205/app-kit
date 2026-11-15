# Agent rules

- Keep the frontend helpers dependency-free: plain JS and CSS, no build step.
- Every release is a semver git tag and a CHANGELOG.md entry.
- A breaking change is a major version and needs a migration note in the changelog.
- Run `scripts/check.sh` before claiming done. It runs syntax checks, shellcheck (if installed), and the `node --test` tests in `tests/`.

## Tools

- View files with the read tool (use offset/limit for long files), search with the grep tool, find files with the glob tool. Do not use `cat`, `sed -n`, `head`, `tail`, `grep`, `rg`, `wc -l` or `ls -R` in bash to read or search files, also not for several files at once. Trimming a command's own output (`scripts/check.sh 2>&1 | tail -25`) is fine.
- Bash is for running commands (`scripts/check.sh`, `node --test`, git). Do not probe the permission rules with dummy commands.
- Create new files with the write tool. Never `cat > file`, heredocs or `echo >` into repo files, also not behind `cd ... &&`.

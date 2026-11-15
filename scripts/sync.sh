#!/usr/bin/env bash
# Copy the frontend/ (or, with --server, the server/) files of a released
# app-kit tag into an app.
#
#   scripts/sync.sh <tag> <dest-dir>
#   scripts/sync.sh --server <tag> <dest-dir>
#   scripts/sync.sh v0.1.0 public/app-kit
#   scripts/sync.sh --server v0.3.0 src/app-kit
#
# The repo is private. The tag is fetched with the local gh login
# (gh api repos/.../tarball/<tag>). If gh is missing or not logged in, it
# falls back to git clone --depth 1 --branch <tag>, which needs git access of its own.
#
# dest gets a copy of frontend/ (server/ with --server) and a VERSION file with
# the tag. Files in dest that are no longer in that directory are removed.
# Safe to run again.
set -euo pipefail

REPO="${APP_KIT_REPO:-Philipp0205/app-kit}"

usage() {
  echo "usage: scripts/sync.sh <tag> <dest-dir>" >&2
  echo "       scripts/sync.sh --server <tag> <dest-dir>" >&2
  echo "example: scripts/sync.sh v0.1.0 public/app-kit" >&2
  echo "example: scripts/sync.sh --server v0.3.0 src/app-kit" >&2
}

fail() {
  echo "sync.sh: $*" >&2
  exit 1
}

part="frontend"
if [ "${1:-}" = "--server" ]; then
  part="server"
  shift
fi

if [ "$#" -ne 2 ]; then
  usage
  exit 2
fi

tag="$1"
dest="$2"

case "$tag" in
  "" | -* | *[!A-Za-z0-9._/-]*)
    usage
    fail "bad tag '$tag'. Use a release tag such as v0.1.0."
    ;;
esac

if [ -z "$dest" ]; then
  usage
  fail "dest-dir is empty."
fi
case "$dest" in
  / | . | ..)
    fail "refusing to sync into '$dest'."
    ;;
esac

command -v tar >/dev/null 2>&1 || fail "tar is required."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
tree="$tmp/tree"
mkdir -p "$tree"

# Try the gh login first. Returns non-zero (with a reason on stderr) if it cannot be used.
fetch_with_gh() {
  if ! command -v gh >/dev/null 2>&1; then
    echo "sync.sh: gh is not installed." >&2
    return 1
  fi
  if ! gh auth status >/dev/null 2>&1; then
    echo "sync.sh: gh is not logged in. Run: gh auth login" >&2
    return 1
  fi
  if ! gh api "repos/$REPO/tarball/$tag" >"$tmp/kit.tar.gz" 2>"$tmp/gh.err"; then
    echo "sync.sh: gh could not fetch tag '$tag' of $REPO:" >&2
    cat "$tmp/gh.err" >&2
    return 1
  fi
  tar -xzf "$tmp/kit.tar.gz" -C "$tree" --strip-components=1
}

fetch_with_git() {
  if ! command -v git >/dev/null 2>&1; then
    echo "sync.sh: git is not installed." >&2
    return 1
  fi
  rm -rf "$tree"
  if ! git clone --quiet --depth 1 --branch "$tag" "https://github.com/$REPO.git" "$tree" 2>"$tmp/git.err"; then
    echo "sync.sh: git clone of tag '$tag' failed:" >&2
    cat "$tmp/git.err" >&2
    return 1
  fi
}

if ! fetch_with_gh; then
  echo "sync.sh: trying git clone instead." >&2
  rm -rf "$tree"
  mkdir -p "$tree"
  fetch_with_git || fail "could not fetch '$tag'. Log in with 'gh auth login' (the repo is private) and try again."
fi

src="$tree/$part"
[ -d "$src" ] || fail "tag '$tag' has no $part/ directory."

# Refuse a non-empty dest that was not made by this script (no VERSION file),
# so a wrong path such as public/ never loses the app's own files.
if [ -d "$dest" ] && [ -n "$(ls -A "$dest")" ] && [ ! -f "$dest/VERSION" ]; then
  fail "'$dest' is not empty and has no VERSION file. Point it at a dedicated folder such as public/app-kit."
fi

# Only now touch dest, so a failed fetch leaves it as it was.
mkdir -p "$dest"

# Remove kit files that are gone from the source directory. VERSION stays.
while IFS= read -r -d '' file; do
  rel="${file#"$dest"/}"
  [ "$rel" = "VERSION" ] && continue
  if [ ! -e "$src/$rel" ]; then
    rm -f "$file"
  fi
done < <(find "$dest" -type f -print0)
find "$dest" -mindepth 1 -type d -empty -delete

cp -R "$src"/. "$dest"/
printf '%s' "$tag" >"$dest/VERSION"

echo "app-kit $tag synced to $dest"

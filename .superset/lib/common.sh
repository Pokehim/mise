# Helpers shared by the lifecycle scripts. Expects to run from the worktree root.

step() {
  printf '\n==> %s\n' "$*"
}

# Directories (relative, root first) holding a tracked or new file named $1,
# at most two levels deep. Ignored paths such as node_modules are skipped.
project_dirs() {
  git ls-files --cached --others --exclude-standard -- "$1" "*/$1" |
    awk -F/ 'NF <= 3' |
    while IFS= read -r f; do dirname "$f"; done |
    LC_ALL=C sort -u
}

# Package manager for the Node project in directory $1, falling back to the
# repo root for monorepos that keep a single lockfile.
node_pm() {
  local d pm
  for d in "$1" .; do
    pm=$(jq -r '.packageManager // empty' "$d/package.json" 2>/dev/null | cut -d@ -f1)
    if [ -n "$pm" ]; then echo "$pm"; return; fi
    if [ -f "$d/bun.lock" ] || [ -f "$d/bun.lockb" ]; then echo bun; return; fi
    if [ -f "$d/pnpm-lock.yaml" ]; then echo pnpm; return; fi
    if [ -f "$d/yarn.lock" ]; then echo yarn; return; fi
    if [ -f "$d/package-lock.json" ]; then echo npm; return; fi
  done
  echo npm
}

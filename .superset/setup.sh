#!/usr/bin/env bash
# Runs when Superset creates a workspace (wired up in .superset/config.json).
# Safe to re-run by hand: it only fills in what is missing.
set -euo pipefail

WORKTREE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ROOT="${SUPERSET_ROOT_PATH:-}"
cd "$WORKTREE"
# shellcheck source=lib/common.sh
source .superset/lib/common.sh
# shellcheck source=lib/ports.sh
source .superset/lib/ports.sh

# Untracked files to bring over from the main checkout, as find -name
# patterns. Add more as the project grows (e.g. 'service-account.json').
COPY_NAMES=('.env' '.env.*')

copy_untracked_files() {
  step "Copying untracked files from the main checkout"
  if [ -z "$ROOT" ] || [ ! -d "$ROOT" ] || [ "$ROOT" -ef "$WORKTREE" ]; then
    echo "skipped: no separate main checkout (SUPERSET_ROOT_PATH='$ROOT')"
    return
  fi
  local match=() name src rel copied=0
  for name in "${COPY_NAMES[@]}"; do match+=(-o -name "$name"); done
  while IFS= read -r -d '' src; do
    rel="${src#"$ROOT"/}"
    # Tracked files are already checked out in the worktree.
    if git -C "$ROOT" ls-files --error-unmatch -- "$rel" >/dev/null 2>&1; then continue; fi
    if [ -e "$rel" ]; then
      echo "kept existing $rel"
      continue
    fi
    mkdir -p "$(dirname "$rel")"
    cp -p "$src" "$rel"
    echo "copied $rel"
    copied=$((copied + 1))
  done < <(find "$ROOT" -maxdepth 4 \
    \( -name .git -o -name node_modules -o -name .venv -o -name .next -o -name dist -o -name build \) -prune \
    -o -type f \( "${match[@]:1}" \) -print0)
  if [ "$copied" -eq 0 ]; then echo "nothing new to copy"; fi
}

# Fallback for env files the main checkout doesn't have yet.
env_from_examples() {
  local example env
  while IFS= read -r example; do
    env="$(dirname "$example")/.env"
    if [ -e "$env" ]; then continue; fi
    cp "$example" "$env"
    echo "created ${env#./} from $example (fill in real values)"
  done < <(git ls-files -- '.env.example' '*/.env.example')
}

install_node() {
  local dirs dir pm
  # A workspaces root installs all of its packages in one go.
  if [ -f package.json ] && { [ -f pnpm-workspace.yaml ] || jq -e '.workspaces' package.json >/dev/null 2>&1; }; then
    dirs=.
  else
    dirs=$(project_dirs package.json)
  fi
  if [ -z "$dirs" ]; then return; fi
  while IFS= read -r dir; do
    pm=$(node_pm "$dir")
    step "Installing Node dependencies in $dir ($pm)"
    if ! command -v "$pm" >/dev/null; then
      echo "$pm is not installed. Install it, then re-run ./.superset/setup.sh" >&2
      return 1
    fi
    case "$pm" in
      npm)
        if [ -f "$dir/package-lock.json" ]; then
          (cd "$dir" && npm ci --no-audit --no-fund)
        else
          (cd "$dir" && npm install --no-audit --no-fund)
        fi
        ;;
      pnpm) (cd "$dir" && pnpm install --prefer-offline) ;;
      *) (cd "$dir" && "$pm" install) ;;
    esac
  done <<<"$dirs"
}

install_python() {
  local dir
  while IFS= read -r dir; do
    step "Installing Python dependencies in $dir"
    (
      cd "$dir"
      if [ -f pyproject.toml ] && grep -q '^\[project\]' pyproject.toml; then
        if command -v uv >/dev/null; then
          uv sync
        else
          [ -d .venv ] || python3 -m venv .venv
          .venv/bin/pip install -e .
        fi
      elif [ -f requirements.txt ]; then
        if command -v uv >/dev/null; then
          [ -d .venv ] || uv venv
          uv pip install -r requirements.txt
        else
          [ -d .venv ] || python3 -m venv .venv
          .venv/bin/pip install -r requirements.txt
        fi
      else
        echo "no [project] table or requirements.txt; skipping"
      fi
    )
  done < <({ project_dirs pyproject.toml; project_dirs requirements.txt; } | LC_ALL=C sort -u)
}

copy_untracked_files
env_from_examples
install_node
install_python

step "Reserving ports for this workspace"
base=$(port_base "$WORKTREE")
echo "PORT=$base API_PORT=$((base + 1)) (block $base-$((base + PORT_RANGE - 1)))"

step "Workspace ready. Press Run to start the dev server."

#!/usr/bin/env bash
# Superset's Run button. Exports this workspace's ports, then starts the dev
# server: the "dev" script of the root package.json, or else of the first
# package.json found up to two levels down. For anything else, replace "run"
# in .superset/config.json (port_base in lib/ports.sh gives the port block).
set -euo pipefail

WORKTREE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$WORKTREE"
# shellcheck source=lib/common.sh
source .superset/lib/common.sh
# shellcheck source=lib/ports.sh
source .superset/lib/ports.sh

base=$(port_base "$WORKTREE")
export SUPERSET_PORT_BASE=$base PORT=$base API_PORT=$((base + 1))

if port_listening "$PORT"; then
  echo "Port $PORT (this workspace's PORT) is already in use. Stop this first:" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
  exit 1
fi

dir=""
while IFS= read -r d; do
  if jq -e '.scripts.dev' "$d/package.json" >/dev/null 2>&1; then
    dir=$d
    break
  fi
done < <(project_dirs package.json)

if [ -z "$dir" ]; then
  echo 'No dev server found. Add a "dev" script to package.json, or set "run" in .superset/config.json.' >&2
  exit 1
fi

if [ ! -d "$dir/node_modules" ] && [ ! -d node_modules ] &&
  jq -e '(.dependencies // {}) + (.devDependencies // {}) | length > 0' "$dir/package.json" >/dev/null; then
  echo "Dependencies are missing; running setup first."
  ./.superset/setup.sh
fi

# Next.js, Nuxt and most Node servers read $PORT; Vite-based tools need a flag.
args=()
case "$(jq -r '.scripts.dev' "$dir/package.json")" in
  *next* | *nuxt*) ;;
  *vite* | *astro* | *react-router* | *remix*) args=(--port "$PORT") ;;
esac

pm=$(node_pm "$dir")
if [ "$pm" = npm ] && [ ${#args[@]} -gt 0 ]; then args=(-- "${args[@]}"); fi

step "Starting $pm run dev in $dir on http://localhost:$PORT (API_PORT=$API_PORT)"
cd "$dir"
exec "$pm" run dev ${args[@]+"${args[@]}"}

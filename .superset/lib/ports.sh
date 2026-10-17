# Per-workspace port blocks so parallel workspaces never fight over dev ports.
#
# ~/.superset/port-allocations.json maps a worktree path to the first port of a
# block of PORT_RANGE ports. This is the convention from
# https://docs.superset.sh/ports (and Superset's own repo), so blocks stay
# disjoint across every project on this machine that uses it.

PORT_ALLOC_FILE="$HOME/.superset/port-allocations.json"
PORT_ALLOC_LOCK="$HOME/.superset/port-allocations.lock"
PORT_START=3100 # leaves 3000-3099 for ad-hoc runs outside Superset
PORT_RANGE=20
# macOS AirPlay Receiver (5000, 7000) and ports Node/Next.js refuse to bind.
PORT_RESERVED="3659 4045 5000 5060 5061 6000 6566 6665 6666 6667 6668 6669 6697 7000"

port_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1
}

port_lock() {
  local waited=0 pid mtime
  mkdir -p "$(dirname "$PORT_ALLOC_LOCK")"
  until mkdir "$PORT_ALLOC_LOCK" 2>/dev/null; do
    pid=$(cat "$PORT_ALLOC_LOCK/pid" 2>/dev/null || true)
    mtime=$(stat -f %m "$PORT_ALLOC_LOCK" 2>/dev/null || stat -c %Y "$PORT_ALLOC_LOCK" 2>/dev/null || echo 0)
    if { [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; } || [ $(($(date +%s) - mtime)) -ge 120 ]; then
      rm -rf "$PORT_ALLOC_LOCK"
      continue
    fi
    if [ "$waited" -ge 30 ]; then
      echo "Timed out waiting for $PORT_ALLOC_LOCK; remove it if no setup is running." >&2
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "$$" >"$PORT_ALLOC_LOCK/pid"
}

port_unlock() {
  rm -rf "$PORT_ALLOC_LOCK"
}

# Writes stdin to the allocations file atomically.
port_alloc_write() {
  local tmp="$PORT_ALLOC_FILE.tmp.$$"
  cat >"$tmp" && mv "$tmp" "$PORT_ALLOC_FILE"
}

# True when [base, base+PORT_RANGE) is clear of reserved ports, other
# workspaces' blocks, and anything already listening on its first two ports.
port_block_free() {
  local base=$1 p
  for p in $PORT_RESERVED; do
    if [ "$p" -ge "$base" ] && [ "$p" -lt $((base + PORT_RANGE)) ]; then return 1; fi
  done
  for p in $2; do
    if [ "$base" -lt $((p + PORT_RANGE)) ] && [ "$p" -lt $((base + PORT_RANGE)) ]; then return 1; fi
  done
  ! port_listening "$base" && ! port_listening $((base + 1))
}

# Prints the port block base for worktree $1, allocating one if it has none.
port_base() {
  local key=$1 base stale used
  if ! command -v jq >/dev/null; then
    echo "jq is required for per-workspace ports (brew install jq)." >&2
    return 1
  fi
  port_lock || return 1
  [ -s "$PORT_ALLOC_FILE" ] || echo '{}' >"$PORT_ALLOC_FILE"

  # Reclaim blocks of worktrees that no longer exist (force-deleted workspaces
  # skip teardown).
  stale=$(jq -r 'keys[]' "$PORT_ALLOC_FILE" | while IFS= read -r k; do [ -d "$k" ] || printf '%s\n' "$k"; done)
  if [ -n "$stale" ]; then
    jq --argjson stale "$(printf '%s\n' "$stale" | jq -R . | jq -s .)" \
      'with_entries(select(.key as $k | $stale | index($k) | not))' "$PORT_ALLOC_FILE" | port_alloc_write
  fi

  base=$(jq -r --arg k "$key" '.[$k] // empty' "$PORT_ALLOC_FILE")
  if [ -z "$base" ]; then
    used=$(jq -r '[.[]] | map(tostring) | join(" ")' "$PORT_ALLOC_FILE")
    base=$PORT_START
    until port_block_free "$base" "$used"; do
      base=$((base + PORT_RANGE))
    done
    jq --arg k "$key" --argjson v "$base" '.[$k] = $v' "$PORT_ALLOC_FILE" | port_alloc_write
  fi
  port_unlock
  echo "$base"
}

# Returns worktree $1's port block to the pool.
port_release() {
  local key=$1
  [ -f "$PORT_ALLOC_FILE" ] && command -v jq >/dev/null || return 0
  port_lock || return 1
  jq --arg k "$key" 'del(.[$k])' "$PORT_ALLOC_FILE" | port_alloc_write
  port_unlock
}

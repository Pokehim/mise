#!/usr/bin/env bash
# Runs when Superset deletes a workspace: stops any server still running from
# this worktree and returns its port block to the pool.
set -uo pipefail

WORKTREE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$WORKTREE"
# shellcheck source=lib/common.sh
source .superset/lib/common.sh
# shellcheck source=lib/ports.sh
source .superset/lib/ports.sh

step "Stopping servers started from this workspace"
pids=""
for pid in $(lsof -nP -iTCP -sTCP:LISTEN -t 2>/dev/null | sort -u); do
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  case "$cwd/" in
    "$WORKTREE"/*) pids="$pids $pid" ;;
  esac
done
pids="${pids# }"
if [ -n "$pids" ]; then
  # shellcheck disable=SC2086
  ps -o pid=,command= -p ${pids// /,} 2>/dev/null
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null
  for _ in 1 2 3 4 5; do
    alive=""
    for pid in $pids; do kill -0 "$pid" 2>/dev/null && alive="$alive $pid"; done
    [ -z "$alive" ] && break
    sleep 1
  done
  # shellcheck disable=SC2086
  [ -n "$alive" ] && kill -9 $alive 2>/dev/null
  echo "stopped:$pids"
else
  echo "none running"
fi

step "Releasing this workspace's ports"
port_release "$WORKTREE" && echo "released"

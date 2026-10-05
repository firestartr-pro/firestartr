#!/usr/bin/env bash
# Build fs-forge from the current checkout and open a run directory.
# Usage: launch.sh [--no-build]
# Prints RUN_DIR=<path>; later scripts find it again through $FSF_HOME/latest.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

build=1
[ "${1:-}" = "--no-build" ] && build=0

fsf_resolve_node || exit 2

mkdir -p "$FSF_HOME"
run="$(mktemp -d "$FSF_HOME/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
mkdir -p "$run/evidence/launch" "$run/work"
ln -sfn "$run" "$FSF_HOME/latest"

# Baselines that cleanup.sh compares against.
fsf_packages_state > "$run/packages-state.before"
git -C "$FSF_REPO" status --porcelain | sort > "$run/git-status.before"

if [ "$build" = 1 ]; then
  [ -d "$FSF_REPO/node_modules" ] || (cd "$FSF_REPO" && npm ci) > "$run/evidence/launch/npm-ci.log" 2>&1
  # prebuild regenerates tracked files from schemas/*.json; the state hash
  # shows whether that changed anything.
  (cd "$FSF_PKG" && npm run build) > "$run/evidence/launch/build.log" 2>&1 ||
    { tail -n 30 "$run/evidence/launch/build.log" >&2; fsf_die "build failed; full log: $run/evidence/launch/build.log"; }
  if [ "$(fsf_packages_state)" != "$(cat "$run/packages-state.before")" ]; then
    echo "WARN: the build changed tracked files under packages/ (codegen drift):" >&2
    git -C "$FSF_REPO" status --porcelain -- packages >&2
  fi
fi

[ -f "$FSF_PKG/dist/commands/kinds.js" ] || fsf_die "dist/ is missing; run launch.sh without --no-build"
version="$(node "$FSF_BIN" --version)"
echo "$version" > "$run/evidence/launch/version.txt"

echo "NODE=$(node -v)"
echo "CLI=$version"
echo "BUILD=$([ "$build" = 1 ] && echo ok || echo skipped)"
echo "RUN_DIR=$run"
echo "LAUNCH OK"

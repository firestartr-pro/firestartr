#!/usr/bin/env bash
# Remove a run's working directories and confirm its evidence survived.
# Usage: cleanup.sh [--purge-evidence]
# fs-forge is a short-lived CLI, so there is no server or process to stop.
# Remote leftovers (branches, PRs, claims created in write mode) are never
# removed here; the write drive's org-diff.txt names them.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

run="$(fsf_run_dir)" || exit 2

if [ "${1:-}" = "--purge-evidence" ]; then
  rm -rf "$run"
  rm -f "$FSF_HOME/latest"
  echo "PURGED $run"
  exit 0
fi

rm -rf "$run/work"
[ ! -e "$run/work" ] || fsf_die "could not remove $run/work"

# The drives run in temp dirs; anything new in the repo's git status is worth a look.
now="$(mktemp)"
git -C "$FSF_REPO" status --porcelain | sort > "$now"
new="$(comm -13 "$run/git-status.before" "$now")"
rm -f "$now"
if [ -n "$new" ]; then
  echo "WARN: git status gained entries since launch (expected only if you edited the repo meanwhile):"
  echo "$new"
fi

files="$(find "$run/evidence" -type f | wc -l | tr -d ' ')"
[ "$files" -gt 0 ] || { echo "FAIL: no evidence files under $run/evidence"; exit 1; }
find "$run/evidence" -type f | sort | sed "s|^$run/||" > "$run/evidence/cleanup-listing.txt"
echo "CLEANUP OK: work/ removed; $files evidence files kept at $run/evidence"

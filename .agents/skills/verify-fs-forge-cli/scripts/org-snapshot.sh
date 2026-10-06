#!/usr/bin/env bash
# Record, then compare, what fs-forge can change in an org's claims repo.
# Read-only: it only calls `gh api` GETs.
#
# Usage:
#   org-snapshot.sh snap <org> <out.json>
#   org-snapshot.sh diff <before.json> <after.json>   (exit 1 when they differ)
#
# A snapshot holds the fs-forge/* branches, the claims PRs from fs-forge/*
# heads, the provision/unprovision workflow runs, and the newest PR numbers of
# the state repos (the provision workflow opens its PRs there).
set -euo pipefail

# GET <path> <jq filter> as one JSON value. Every page `gh api --paginate`
# returns is fed to `jq -s <filter>`, so list endpoints are aggregated instead
# of being truncated at the first page. Any failure aborts the snapshot, since
# GitHub answers 404 for a private repo the token cannot read. Only a call
# marked "optional" (a workflow the org may not have) reads a 404 as an empty
# list. Calls are pinned to github.com, the endpoint the CLI's Octokit uses,
# so a GH_HOST pointing elsewhere cannot make the snapshots watch another server.
get() {
  local path="$1" filter="$2" optional="${3:-}" out
  if out="$(gh api --hostname github.com --paginate "$path" 2>&1)"; then
    printf '%s' "$out" | jq -s "$filter"
    return
  fi
  if [ "$optional" = optional ] && [[ "$out" == *"HTTP 404"* ]]; then echo '[]'; return; fi
  echo "gh api $path failed: $out" >&2
  return 1
}

snap() {
  local org="$1" out="$2" runs_p runs_u state
  runs_p="$(get "repos/$org/claims/actions/workflows/provision-claim.yaml/runs?per_page=100" '[.[].workflow_runs[] | {id,status,conclusion,head_branch}]' optional)"
  runs_u="$(get "repos/$org/claims/actions/workflows/unprovision-claim.yaml/runs?per_page=100" '[.[].workflow_runs[] | {id,status,conclusion,head_branch}]' optional)"
  state="$(for repo in state-github state-infra; do
    get "repos/$org/$repo/pulls?state=all&per_page=100" 'add // []' | jq --arg repo "$repo" '{($repo): [.[].number]}' || exit 1
  done | jq -s add)"
  jq -n \
    --arg org "$org" \
    --arg at "$(date -u +%FT%TZ)" \
    --argjson branches "$(get "repos/$org/claims/git/matching-refs/heads/fs-forge/" 'add // [] | [.[] | {ref, sha: .object.sha}]')" \
    --argjson prs "$(get "repos/$org/claims/pulls?state=all&per_page=100" 'add // [] | [.[] | select(.head.ref | startswith("fs-forge/")) | {number, head: .head.ref, state, merged: (.merged_at != null)}]')" \
    --argjson runs_p "$runs_p" --argjson runs_u "$runs_u" --argjson state "$state" \
    '{org: $org, takenAt: $at, branches: $branches, claimsPrs: $prs, runs: {provision: $runs_p, unprovision: $runs_u}, statePrs: $state}' > "$out"
}

case "${1:-}" in
  snap) [ $# = 3 ] || { echo "usage: $0 snap <org> <out.json>" >&2; exit 2; }; snap "$2" "$3" ;;
  diff)
    [ $# = 3 ] || { echo "usage: $0 diff <before.json> <after.json>" >&2; exit 2; }
    if diff -u --label before --label after <(jq -S 'del(.takenAt)' "$2") <(jq -S 'del(.takenAt)' "$3"); then
      echo "no change in fs-forge branches, PRs or workflow runs"
    else
      exit 1
    fi
    ;;
  *) echo "usage: $0 snap <org> <out.json> | diff <before.json> <after.json>" >&2; exit 2 ;;
esac

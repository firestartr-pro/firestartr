#!/usr/bin/env bash
# The ia-test claims a live write run uses, and the teardown that puts the org
# back the way it was.
#
# Usage:
#   fixture.sh setup --org ORG --id ID
#   fixture.sh teardown --org ORG --id ID [--issue N] [--wait SECONDS]
#
# setup writes the two seeds a write run needs, both annotated
# firestartr.dev/ia-test: "true", under $FSF_HOME/fixtures/<org>/<id>/ and
# schema-validates them with the CLI. It contacts nothing.
#
# teardown deletes both claims with `delete <kind> <name> --commit` through
# drive.sh, waits for the team and the repo to disappear, removes leftover
# fs-forge/*fsf-verify-<id>* branches and closes their PRs, deletes a leftover
# fsf-verify-* repo, and then proves the org is clean with `gh api`: every
# leftover is a FAIL that names it and teardown exits 1. Rerun it after a
# half-failed run; a claim that is already gone is skipped.
#
# --issue N passes `--issue N` to the ComponentClaim delete, the audit-trail
# path a write run has to prove. --wait bounds the poll for the operator's
# teardown of the team and the repo (default 600 seconds).
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() {
  cat >&2 <<'USAGE'
usage: fixture.sh setup --org <org> --id <id>
       fixture.sh teardown --org <org> --id <id> [--issue <n>] [--wait <seconds>]
USAGE
  exit 2
}

action="${1:-}"
case "$action" in
  setup|teardown) shift ;;
  *) usage ;;
esac

org="" id="" issue="" wait_limit=600
while [ $# -gt 0 ]; do
  case "$1" in
    --org|--id|--issue|--wait) [ $# -ge 2 ] || usage ;;
    *) usage ;;
  esac
  case "$1" in
    --org) org="$2"; shift 2 ;;
    --id) id="$2"; shift 2 ;;
    --issue) issue="$2"; shift 2 ;;
    --wait) wait_limit="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[ -n "$org" ] || { echo "ERROR: --org is required; never assume the org" >&2; exit 2; }
[ -n "$id" ] || { echo "ERROR: --id is required; it names the run and keeps reruns idempotent" >&2; exit 2; }
case "$id" in
  ""|*[!a-z0-9-]*) echo "ERROR: --id takes lowercase letters, digits and dashes only: $id" >&2; exit 2 ;;
esac
case "$issue" in ""|*[!0-9]*) [ -z "$issue" ] || { echo "ERROR: --issue takes a positive issue number" >&2; exit 2; } ;; esac
case "$wait_limit" in ""|*[!0-9]*) echo "ERROR: --wait takes a number of seconds" >&2; exit 2 ;; esac

group="fsf-verify-grp-$id"
component="fsf-verify-cmp-$id"
fixture_dir="$FSF_HOME/fixtures/$org/$id"
claims_repo="$org/claims"
drive="$FSF_SKILL_DIR/scripts/drive.sh"

# --- setup ------------------------------------------------------------------
write_seeds() {
  mkdir -p "$fixture_dir" || fsf_die "could not create $fixture_dir"
  cat > "$fixture_dir/group.yaml" <<YAML
kind: GroupClaim
version: "1.0"
name: $group
description: fs-forge write-drive fixture ($id)
type: business-unit
profile:
  displayName: $group
members: []
providers:
  github:
    name: $group
    org: $org
    privacy: closed
annotations:
  firestartr.dev/ia-test: "true"
YAML
  cat > "$fixture_dir/component.yaml" <<YAML
kind: ComponentClaim
version: "1.0"
name: $component
type: service
lifecycle: production
description: fs-forge write-drive fixture ($id)
owner: group:firestartr
system: system:pre-vieitesss-system
maintainedBy: []
platformOwner: group:firestartr
providers:
  github:
    name: $component
    org: $org
    visibility: private
    description: fs-forge write-drive fixture ($id)
    sync:
      enabled: true
      period: 24h
    branchStrategy:
      name: none
      defaultBranch: main
    allowAutoMerge: true
    deleteBranchOnMerge: true
    orgPermissions: contribute
    technology:
      stack: none
      version: none
    features: []
annotations:
  firestartr.dev/ia-test: "true"
YAML
  cat > "$fixture_dir/meta.env" <<ENV
ORG=$org
ID=$id
GROUP=$group
COMPONENT=$component
FIXTURE_DIR=$fixture_dir
ENV
}

setup() {
  fsf_resolve_node || exit 2
  write_seeds
  # The seeds are the claims the write drives create, so they must be valid.
  if output="$(cd "$fixture_dir" && env -u GITHUB_TOKEN -u GH_TOKEN -u FSCRT_ORG \
    "FS_FORGE_FEATURE_CACHE_DIR=$fixture_dir/.feature-cache" \
    node "$FSF_BIN" validate -f group.yaml -f component.yaml 2>&1)"; then
    echo "PASS seeds: both claims are valid"
  else
    echo "$output" >&2
    fsf_die "the seeds do not validate against their claim schemas"
  fi
  cat <<INFO
FIXTURE $fixture_dir
GROUP $group
COMPONENT $component

Create them with (each needs --mode write and the user's approval):

  $drive --mode write --org $org --label ob-create-group --seed $fixture_dir/group.yaml \\
    -- create group --name $group --description "fs-forge verification $id" \\
    --type business-unit --profile.displayName $group \\
    --providers.github.name $group --providers.github.org $org --providers.github.privacy closed \\
    --annotations.json '{"firestartr.dev/ia-test":"true"}' --commit

  $drive --mode write --org $org --label ob-create-component --seed $fixture_dir/component.yaml \\
    -- create component --name $component --owner group:firestartr \\
    --description "fs-forge verification $id" \\
    --providers.github.name $component --providers.github.org $org \\
    --providers.github.visibility private --providers.github.description "fs-forge verification $id" \\
    --annotations.json '{"firestartr.dev/ia-test":"true"}' --commit

Then tear both down with:

  $0 teardown --org $org --id $id
INFO
}

# --- teardown ---------------------------------------------------------------
gh_api() { gh api --hostname github.com "$@"; }
has_token() { fsf_token >/dev/null; }

claim_path() { # <kind dir> <name> -> prints the claim's path in the claims repo
  case "$1" in group) echo "claims/groups/$2.yaml" ;; *) echo "claims/components/$2.yaml" ;; esac
}

claim_exists() { # <kind dir in the claims repo> <name>
  gh_api "repos/$claims_repo/contents/$(claim_path "$1" "$2")" >/dev/null 2>&1
}

repo_gone() { ! gh_api "repos/$org/$component" >/dev/null 2>&1; }
team_gone() { ! gh_api "orgs/$org/teams/$group" >/dev/null 2>&1; }

delete_claim() { # <kind> <name> [extra delete args...]
  local kind="$1" name="$2"
  shift 2
  local label="teardown-delete-$kind"
  local out status
  out="$("$drive" --mode write --org "$org" --label "$label" -- delete "$kind" "$name" --commit "$@" 2>&1)"
  status=$?
  printf '%s\n' "$out" | grep -E '^DRIVE ' || printf '%s\n' "$out" | tail -n 5
  return "$status"
}

wait_for() { # <seconds> <command...>
  local limit="$1" waited=0
  shift
  while [ "$waited" -lt "$limit" ]; do
    "$@" && return 0
    sleep 10
    waited=$((waited + 10))
  done
  return 1
}

sweep() {
  local ref prs
  # Branches first: a leftover branch would block the next create of that claim.
  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    if gh_api -X DELETE "repos/$claims_repo/git/refs/heads/${ref#refs/heads/}" >/dev/null 2>&1; then
      echo "SWEPT branch ${ref#refs/heads/}"
    else
      echo "FAIL sweep: could not delete branch ${ref#refs/heads/}"
    fi
  done < <(gh_api "repos/$claims_repo/git/matching-refs/heads/fs-forge/" --jq '.[].ref' 2>/dev/null | grep -E "fsf-verify-(grp|cmp)-$id")
  while IFS=$'\t' read -r number head; do
    [ -n "$number" ] || continue
    if gh_api -X PATCH "repos/$claims_repo/pulls/$number" -f state=closed >/dev/null 2>&1; then
      echo "SWEPT PR #$number ($head)"
    else
      echo "FAIL sweep: could not close PR #$number"
    fi
  done < <(gh_api "repos/$claims_repo/pulls?state=open&per_page=100" --jq '.[] | [.number, .head.ref] | @tsv' 2>/dev/null | grep -E "fsf-verify-(grp|cmp)-$id")
  if ! repo_gone; then
    if gh_api -X DELETE "repos/$org/$component" >/dev/null 2>&1; then
      echo "SWEPT repository $org/$component"
    else
      echo "FAIL sweep: could not delete repository $org/$component"
      local archived
      archived="$(gh_api "repos/$org/$component" --jq .archived 2>/dev/null)"
      [ "$archived" != true ] || echo "FAIL sweep: $org/$component is archived, so it survived the delete"
    fi
  fi
  while IFS=$'\t' read -r number title; do
    [ -n "$number" ] || continue
    if gh_api -X PATCH "repos/$claims_repo/issues/$number" -f state=closed >/dev/null 2>&1; then
      echo "SWEPT issue #$number ($title)"
    else
      echo "FAIL sweep: could not close issue #$number"
    fi
  done < <(gh_api "repos/$claims_repo/issues?state=open&per_page=100" --jq '.[] | select(.pull_request == null) | [.number, .title] | @tsv' 2>/dev/null | grep -F "$id")
}

fail_count=0
pass() { echo "PASS $1: $2"; }
fail() { echo "FAIL $1: $2"; fail_count=$((fail_count + 1)); }

prove_clean() {
  local paths refs prs state_paths repo_status team_status issues
  paths="$(gh_api "repos/$claims_repo/git/trees/HEAD?recursive=1" --paginate --jq '.tree[].path' 2>/dev/null |
    grep -E "^claims/(components|groups)/fsf-verify-(grp|cmp)-$id\.yaml$")"
  [ -z "$paths" ] && pass claims-files "no $group or $component claim file in $claims_repo" ||
    fail claims-files "claims left in $claims_repo: $(printf '%s' "$paths" | tr '\n' ' ')"
  refs="$(gh_api "repos/$claims_repo/git/matching-refs/heads/fs-forge/" --jq '.[].ref' 2>/dev/null |
    grep -E "fsf-verify-(grp|cmp)-$id")"
  [ -z "$refs" ] && pass claims-branches "no fs-forge/*fsf-verify-$id* branch in $claims_repo" ||
    fail claims-branches "branches left in $claims_repo: $(printf '%s' "$refs" | tr '\n' ' ')"
  prs="$(gh_api "repos/$claims_repo/pulls?state=open&per_page=100" --jq '.[] | "\(.number) \(.head.ref)"' 2>/dev/null |
    grep -E "fsf-verify-(grp|cmp)-$id")"
  [ -z "$prs" ] && pass claims-prs "no open fs-forge/*fsf-verify-$id* PR in $claims_repo" ||
    fail claims-prs "open PRs left in $claims_repo: $(printf '%s' "$prs" | tr '\n' ' ')"
  state_paths="$(for repo in state-github state-infra; do
    gh_api "repos/$org/$repo/git/trees/HEAD?recursive=1" --paginate --jq '.tree[].path' 2>/dev/null | grep -F "$id" || true
  done)"
  [ -z "$state_paths" ] && pass state-crs "no $id CR left in $org/state-github or $org/state-infra" ||
    fail state-crs "CRs left: $(printf '%s' "$state_paths" | tr '\n' ' ')"
  if repo_gone; then pass github-repo "$org/$component is gone"; else fail github-repo "$org/$component still exists"; fi
  if team_gone; then pass github-team "$org/$group team is gone"; else fail github-team "$org/$group team still exists"; fi
  issues="$(gh_api "repos/$claims_repo/issues?state=open&per_page=100" --jq '.[] | select(.pull_request == null) | "\(.number) \(.title)"' 2>/dev/null |
    grep -F "$id")"
  [ -z "$issues" ] && pass claims-issues "no open $id issue in $claims_repo" ||
    fail claims-issues "open issues left: $(printf '%s' "$issues" | tr '\n' ' ')"
}

teardown() {
  has_token || fsf_die "no GH_TOKEN, GITHUB_TOKEN or 'gh auth token'"
  command -v gh >/dev/null 2>&1 || fsf_die "gh is required to read and sweep the org"
  local failed=0
  if claim_exists components "$component"; then
    if [ -n "$issue" ]; then
      delete_claim component "$component" --issue "$issue" || failed=1
    else
      delete_claim component "$component" || failed=1
    fi
  else
    echo "SKIP delete component $component: not in $claims_repo"
  fi
  if claim_exists groups "$group"; then
    delete_claim group "$group" || failed=1
  else
    echo "SKIP delete group $group: not in $claims_repo"
  fi
  if [ "$failed" = 0 ]; then
    wait_for "$wait_limit" repo_gone || echo "WAIT timeout after ${wait_limit}s: $org/$component still exists"
    wait_for "$wait_limit" team_gone || echo "WAIT timeout after ${wait_limit}s: the $group team still exists"
  fi
  sweep
  prove_clean
  if [ "$fail_count" = 0 ]; then
    echo "TEARDOWN OK: $org is back to clean for id $id; fixture kept at $fixture_dir"
  else
    echo "TEARDOWN FAILED: $fail_count leftover(s) above; rerun once they are resolved"
    return 1
  fi
}

case "$action" in
  setup) setup ;;
  teardown) teardown ;;
  *) usage ;;
esac

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
# teardown refuses an org that is not a registered pre org first, with the same
# check `drive.sh --mode write` makes, so nothing is touched before that passes.
# It then deletes both claims with `delete <kind> <name> --commit` through
# drive.sh, waits for the team and the repo to disappear, removes leftover
# fs-forge/* branches named exactly `fsf-verify-grp-<id>` or
# `fsf-verify-cmp-<id>` and closes their PRs, deletes a leftover
# `fsf-verify-cmp-<id>` repo, and then proves the org is clean with `gh api`:
# every leftover is a FAIL that names it, a `gh api` error is a FAIL that names
# the error, and teardown exits 1. Rerun it after a half-failed run; a claim
# that is already gone is skipped.
#
# A delete that does not finish leaves its own deletion PR open: closing it
# would throw away the only way forward. teardown names the PR to merge once PR
# Verify is green, names the rerun, and exits 1.
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
# The id is spliced into a regex below, so only characters that carry no regex
# meaning are allowed.
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
  # These are the claims the printed create commands build: `create` fills a
  # claim from its flags and the schema defaults, not from the org's
  # .config/claims_defaults.yaml (that is what `defaults apply` is for), so a
  # seed that carried extra fields would not match what lands in the org.
  cat > "$fixture_dir/group.yaml" <<YAML
kind: GroupClaim
name: $group
type: business-unit
annotations:
  firestartr.dev/ia-test: "true"
profile:
  displayName: $group
providers:
  github:
    name: $group
    org: $org
    privacy: closed
description: fs-forge verification $id
YAML
  cat > "$fixture_dir/component.yaml" <<YAML
kind: ComponentClaim
name: $component
owner: group:firestartr
providers:
  github:
    name: $component
    org: $org
    visibility: private
    branchStrategy:
      name: none
description: fs-forge verification $id
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

  $drive --mode write --org $org --label ob-create-component-issue --seed $fixture_dir/component.yaml \\
    -- create component --name $component --owner group:firestartr \\
    --description "fs-forge verification $id" \\
    --providers.github.name $component --providers.github.org $org \\
    --providers.github.visibility private --providers.github.branchStrategy.name none \\
    --annotations.json '{"firestartr.dev/ia-test":"true"}' --commit --create-issue

Then tear both down with:

  $0 teardown --org $org --id $id
INFO
}

# --- teardown ---------------------------------------------------------------
gh_api() { gh api --hostname github.com "$@"; }
has_token() { fsf_token >/dev/null; }

# The exact names this run owns. The id is anchored at the end, so `--id 1`
# cannot match `fsf-verify-grp-11031126-a`; a name closes on end-of-string or on
# any character outside [a-z0-9-], which covers `.yaml`, `/` and a trailing
# space or quote.
fixture_re() { printf 'fsf-verify-(grp|cmp)-%s([^a-z0-9-]|$)' "$id"; }

# gh api GET with --paginate: the lines <jq filter> yields that match <pattern>.
# Exit 0 with the matches (none is an empty list, and empty is clean), 1 when
# GitHub answered a real 404, and 2 when the call failed for any other reason --
# 401, 403, 429, 500, a dropped network -- because that must never read as
# clean. api_error carries the reason for the caller's FAIL line.
api_error=""
api_lines() { # <path> <jq filter> <extended regex>
  local path="$1" filter="$2" pattern="$3" out
  api_error=""
  if ! out="$(gh_api --paginate "$path" --jq "$filter" 2>&1)"; then
    case "$out" in
      *"HTTP 404"*) return 1 ;;
    esac
    api_error="$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
    return 2
  fi
  printf '%s' "$out" | grep -E -- "$pattern" || true
}

# The same distinction for one resource: 0 gone (a real 404), 1 still there,
# 2 unreadable with api_error set.
api_gone() { # <path>
  local out
  api_error=""
  if out="$(gh_api "$1" 2>&1)"; then return 1; fi
  case "$out" in
    *"HTTP 404"*) return 0 ;;
  esac
  api_error="$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
  return 2
}

claim_path() { # <kind dir> <name> -> prints the claim's path in the claims repo
  case "$1" in
  group | groups) echo "claims/groups/$2.yaml" ;;
  component | components) echo "claims/components/$2.yaml" ;;
  *) fsf_die "claim_path: unknown kind dir $1" ;;
  esac
}

claim_exists() { # <kind dir in the claims repo> <name>
  gh_api "repos/$claims_repo/contents/$(claim_path "$1" "$2")" >/dev/null 2>&1
}

repo_gone() { api_gone "repos/$org/$component"; }
team_gone() { api_gone "orgs/$org/teams/$group"; }

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

leftover_branches() { # branches in the claims repo that name this id, whatever the prefix
  # A delete publishes on automated-non-automerge/ when the claim cannot automerge, so
  # filtering on fs-forge/ alone would leave the branch that blocks the next delete.
  api_lines "repos/$claims_repo/branches?per_page=100" '.[].name' "$(fixture_re)"
}

# Closes and deletes only what names this run's two fixtures. A listing that
# fails is a FAIL that names it, never "nothing left to sweep".
sweep() {
  local ref number head title out status
  # Branches first: a leftover branch would block the next create of that claim.
  out="$(leftover_branches)"
  status=$?
  if [ "$status" = 2 ]; then
    echo "FAIL sweep: could not list the $claims_repo branches: $api_error"
  else
    while IFS= read -r ref; do
      [ -n "$ref" ] || continue
      if gh_api -X DELETE "repos/$claims_repo/git/refs/heads/$ref" >/dev/null 2>&1; then
        echo "SWEPT branch $ref"
      else
        echo "FAIL sweep: could not delete branch $ref"
      fi
    done <<< "$out"
  fi
  out="$(api_lines "repos/$claims_repo/pulls?state=open&per_page=100" '.[] | [.number, .head.ref] | @tsv' "$(fixture_re)")"
  status=$?
  if [ "$status" = 2 ]; then
    echo "FAIL sweep: could not list the $claims_repo pull requests: $api_error"
  else
    while IFS=$'\t' read -r number head; do
      [ -n "$number" ] || continue
      if gh_api -X PATCH "repos/$claims_repo/pulls/$number" -f state=closed >/dev/null 2>&1; then
        echo "SWEPT PR #$number ($head)"
      else
        echo "FAIL sweep: could not close PR #$number"
      fi
    done <<< "$out"
  fi
  repo_gone
  status=$?
  if [ "$status" = 1 ]; then
    if gh_api -X DELETE "repos/$org/$component" >/dev/null 2>&1; then
      echo "SWEPT repository $org/$component"
    else
      echo "FAIL sweep: could not delete repository $org/$component"
      local archived
      archived="$(gh_api "repos/$org/$component" --jq .archived 2>/dev/null)"
      [ "$archived" != true ] || echo "FAIL sweep: $org/$component is archived, so it survived the delete"
    fi
  elif [ "$status" = 2 ]; then
    echo "FAIL sweep: could not read $org/$component: $api_error"
  fi
  out="$(api_lines "repos/$claims_repo/issues?state=open&per_page=100" '.[] | select(.pull_request == null) | [.number, .title] | @tsv' "$(fixture_re)")"
  status=$?
  if [ "$status" = 2 ]; then
    echo "FAIL sweep: could not list the $claims_repo issues: $api_error"
  else
    while IFS=$'\t' read -r number title; do
      [ -n "$number" ] || continue
      if gh_api -X PATCH "repos/$claims_repo/issues/$number" -f state=closed >/dev/null 2>&1; then
        echo "SWEPT issue #$number ($title)"
      else
        echo "FAIL sweep: could not close issue #$number"
      fi
    done <<< "$out"
  fi
}

fail_count=0
pass() { echo "PASS $1: $2"; }
fail() { echo "FAIL $1: $2"; fail_count=$((fail_count + 1)); }

# One clean check: a listing's matches, a 404, or a failed call.
verdict() { # <check> <pass message> <leftover noun> <status> <found lines> <path>
  local name="$1" ok="$2" noun="$3" status="$4" found="$5" path="$6"
  case "$status" in
  0)
    if [ -z "$found" ]; then
      pass "$name" "$ok"
    else
      fail "$name" "$noun: $(printf '%s' "$found" | tr '\n' ' ')"
    fi
    ;;
  1) pass "$name" "$ok (GitHub answered 404, so nothing is there)" ;;
  *) fail "$name" "gh api $path failed: $api_error" ;;
  esac
}

prove_clean() {
  local out status repo lines s state_path=""
  out="$(api_lines "repos/$claims_repo/git/trees/HEAD?recursive=1" '.tree[].path' "^claims/(components|groups)/$(fixture_re)")"
  status=$?
  verdict claims-files "no $group or $component claim file in $claims_repo" \
    "claims left in $claims_repo" "$status" "$out" "repos/$claims_repo/git/trees/HEAD"
  out="$(leftover_branches)"
  status=$?
  verdict claims-branches "no $group or $component branch in $claims_repo" \
    "branches left in $claims_repo" "$status" "$out" "repos/$claims_repo/branches"
  out="$(api_lines "repos/$claims_repo/pulls?state=open&per_page=100" '.[] | "\(.number) \(.head.ref)"' "$(fixture_re)")"
  status=$?
  verdict claims-prs "no open $group or $component PR in $claims_repo" \
    "open PRs left in $claims_repo" "$status" "$out" "repos/$claims_repo/pulls"
  # The CRs of both state repos: one listing error fails the check, and the
  # first one names itself.
  out="" status=0
  for repo in state-github state-infra; do
    lines="$(api_lines "repos/$org/$repo/git/trees/HEAD?recursive=1" '.tree[].path' "$(fixture_re)")"
    s=$?
    [ -z "$lines" ] || out="$out$lines"$'\n'
    if [ "$s" = 2 ]; then
      status=2
      state_path="repos/$org/$repo/git/trees/HEAD"
      break
    fi
    if [ "$s" = 1 ] && [ "$status" = 0 ]; then status=1; fi
  done
  verdict state-crs "no $group or $component CR left in $org/state-github or $org/state-infra" \
    "CRs left" "$status" "$out" "${state_path:-repos/$org/state-github/git/trees/HEAD}"
  repo_gone
  status=$?
  case "$status" in
  0) pass github-repo "$org/$component is gone" ;;
  1) fail github-repo "$org/$component still exists" ;;
  *) fail github-repo "gh api repos/$org/$component failed: $api_error" ;;
  esac
  team_gone
  status=$?
  case "$status" in
  0) pass github-team "$org/$group team is gone" ;;
  1) fail github-team "$org/$group team still exists" ;;
  *) fail github-team "gh api orgs/$org/teams/$group failed: $api_error" ;;
  esac
  out="$(api_lines "repos/$claims_repo/issues?state=open&per_page=100" '.[] | select(.pull_request == null) | "\(.number) \(.title)"' "$(fixture_re)")"
  status=$?
  verdict claims-issues "no open $group or $component issue in $claims_repo" \
    "open issues left" "$status" "$out" "repos/$claims_repo/issues"
}

# What a human has to do about a delete that did not finish. `delete --commit`
# stops at PR Verify, so the PR it opened is the only way forward: it is left
# open and named here with the rerun that finishes the job.
merge_help() { # <what failed...>
  local out status head url
  # The URL alone carries no fixture name, so the head ref is what the filter
  # matches and the URL is the field a human is told to merge.
  out="$(api_lines "repos/$claims_repo/pulls?state=open&per_page=100" '.[] | [.number, .head.ref, .html_url] | @tsv' "$(fixture_re)")"
  status=$?
  if [ "$status" = 2 ]; then
    echo "HUMAN: could not read the open $claims_repo PRs ($api_error); check the delete of $* and rerun teardown"
  elif [ -z "$out" ]; then
    echo "HUMAN: no open PR names $*; the delete failed before opening one, so read its DRIVE output above and rerun teardown"
  else
    while IFS=$'\t' read -r _ head url; do
      [ -n "$url" ] || continue
      echo "HUMAN: merge $url once PR Verify is green, then rerun teardown"
    done <<< "$out"
  fi
  echo "HUMAN: rerun: $0 teardown --org $org --id $id"
}

teardown() {
  # A teardown mutates the org, so it takes the gate a write drive takes. It is
  # the first thing that happens: a non-pre org is refused before any read that
  # could lead to a sweep, and long before any gh api write.
  fsf_require_pre_org "$org" teardown
  has_token || fsf_die "no GH_TOKEN, GITHUB_TOKEN or 'gh auth token'"
  command -v gh >/dev/null 2>&1 || fsf_die "gh is required to read and sweep the org"
  local failed=0 pending=""
  # Sweep first so a rerun after a half-failure starts from a claim that can be
  # published again instead of tripping over its own leftover branch or PR.
  sweep
  if claim_exists components "$component"; then
    if [ -n "$issue" ]; then
      delete_claim component "$component" --issue "$issue" || { failed=1; pending="$pending $component"; }
    else
      delete_claim component "$component" || { failed=1; pending="$pending $component"; }
    fi
  else
    echo "SKIP delete component $component: not in $claims_repo"
  fi
  if claim_exists groups "$group"; then
    delete_claim group "$group" || { failed=1; pending="$pending $group"; }
  else
    echo "SKIP delete group $group: not in $claims_repo"
  fi
  if [ "$failed" = 0 ]; then
    wait_for "$wait_limit" repo_gone || echo "WAIT timeout after ${wait_limit}s: $org/$component still exists"
    wait_for "$wait_limit" team_gone || echo "WAIT timeout after ${wait_limit}s: the $group team still exists"
  fi
  # A failed delete leaves the PR a human has to merge. Closing it here would
  # throw away the only way forward, so the closing sweep waits for a rerun.
  if [ "$failed" = 0 ]; then
    sweep
  fi
  prove_clean
  if [ "$failed" != 0 ]; then
    merge_help "${pending# }"
  fi
  if [ "$fail_count" = 0 ] && [ "$failed" = 0 ]; then
    echo "TEARDOWN OK: $org is back to clean for id $id; fixture kept at $fixture_dir"
  else
    echo "TEARDOWN FAILED: $fail_count leftover(s) above and $([ "$failed" = 0 ] && echo no || echo some) delete(s) unfinished; rerun once they are resolved"
    return 1
  fi
}

case "$action" in
  setup) setup ;;
  teardown) teardown ;;
  *) usage ;;
esac

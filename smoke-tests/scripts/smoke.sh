#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if REPO_ROOT="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel 2>/dev/null)"; then
  :
else
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
fi

PATCH_CLAIM="${REPO_ROOT}/packages/cdk8s_renderer/tools/patch-claim.mjs"
PRE_REPO="firestartr-pre/app-firestartr"
PRE_PLATFORM="firestartr-pre"
PRE_ENVIRONMENT="pre"
HYDRATE_WORKFLOW=".github/workflows/hydrate-github-claim.yaml"
DELETE_TFWORKSPACE_WORKFLOW=".github/workflows/delete-tfworkspace-claim.yaml"

ORG=""
YES=false
COMMAND=""
ARGS=()
GUARD_OK=false
PATCHES=()

usage() {
  cat <<EOF
Usage: smoke.sh --org <pre-org> [--yes] <command> [args]

Commands:
  setup                         Clone <org>/claims to .tmp_dir/orgs/<org>/claims, create one pushed test branch
  create <source> <target> [patch...]  Clone claim and apply JSON patches
  patch <claim> [patches...]    Patch a smoke-created claim
  hydrate <name> <kind>         Run "${HYDRATE_WORKFLOW}" in <org>/claims against the test branch
  delete-tfworkspace <name>     Run "${DELETE_TFWORKSPACE_WORKFLOW}" — opens CR+claim deletion PRs, confirms+merges both (always asks)
  versions                      Print deployed operator image and claims-repo CLI version
  summary [pr-url]              Print hydrate PR title/body/state summary
  check [pr-url]                Check hydrate state from PR comments
  merge [pr-url]                Merge hydrate PR (always asks)
  close [pr-url...]             Close open hydrate PR(s) without merging (always asks)
  revert [pr-url...]            Revert merged PR(s), merge revert PR(s), check original PR comments (always asks)
  cleanup                       Delete test branch if it is test/ia-* and remove .tmp_dir/orgs/<org>
  full                          Interactive setup → create → hydrate → summary → merge → check → revert → cleanup
  status                        Show local smoke state

Global options:
  --org, -o <pre-org>           Required. Must exist under ${PRE_REPO}:kubernetes/${PRE_PLATFORM}/<org>/
  --yes, -y                     Skip safe prompts only; merge/close/revert still ask.
EOF
}

abort() { echo "✗ $*" >&2; exit 1; }
ok() { echo "✓ $*"; }
warn() { echo "⚠ $*" >&2; }

ensure_patch_tool() {
  command -v node >/dev/null 2>&1 \
    || abort "'node' not found in PATH. Install Node.js before running create/patch."
  [ -f "${PATCH_CLAIM}" ] \
    || abort "Patch tool not found: ${PATCH_CLAIM}. Ensure the repo is fully checked out."
}

confirm() {
  local prompt="$1"
  local force_prompt="${2:-false}"
  if [ "${YES}" = true ] && [ "${force_prompt}" != true ]; then
    return 0
  fi
  local resp
  read -rp "${prompt} [y/N] " resp
  case "${resp}" in
    y|Y|yes|Yes|YES) return 0 ;;
    *) abort "Aborted by user" ;;
  esac
}

while [ $# -gt 0 ]; do
  case "$1" in
    --org|-o)
      ORG="${2:-}"
      [ -n "${ORG}" ] || abort "--org requires a value"
      shift 2
      ;;
    --yes|-y)
      YES=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      COMMAND="$1"
      shift
      ARGS=("$@")
      break
      ;;
  esac
done

[ -n "${COMMAND}" ] || { usage; exit 1; }
[ -n "${ORG}" ] || abort "--org is required. Ask the user for the org; never assume it."
[[ "${ORG}" =~ ^[a-zA-Z0-9-]+$ ]] || abort "--org value '${ORG}' is not a valid org slug (letters, digits, hyphens only)"

TMP_ROOT="${REPO_ROOT}/.tmp_dir/orgs"
TMP_DIR="${TMP_ROOT}/${ORG}"
CLAIMS_DIR="${TMP_DIR}/claims"
LAST_PR_FILE="${TMP_DIR}/last-pr-url"
SMOKE_STATE="${TMP_DIR}/smoke-state"
CLAIMS_REPO="${ORG}/claims"
PRE_ORG_PATH="kubernetes/${PRE_PLATFORM}/${ORG}"

save_state() {
  mkdir -p "$(dirname "${SMOKE_STATE}")"
  echo "$1=${2:-}" >> "${SMOKE_STATE}"
}

read_state() {
  local key="$1"
  [ -f "${SMOKE_STATE}" ] || return 0
  grep "^${key}=" "${SMOKE_STATE}" | tail -1 | cut -d= -f2- || true
}

check_gh() {
  command -v gh >/dev/null 2>&1 || abort "gh (GitHub CLI) is required"
  gh auth status >/dev/null 2>&1 || abort "gh is not authenticated. Run 'gh auth login'."
}

remote_branch_exists() {
  local branch="$1"
  gh api "repos/${CLAIMS_REPO}/git/ref/heads/${branch}" >/dev/null 2>&1
}

default_branch() {
  gh repo view "${CLAIMS_REPO}" --json defaultBranchRef --jq '.defaultBranchRef.name'
}

guard() {
  [ "${GUARD_OK}" = true ] && return 0
  check_gh
  gh repo view "${PRE_REPO}" >/dev/null 2>&1 || abort "Cannot access pre registry repo: ${PRE_REPO}"
  gh api "repos/${PRE_REPO}/contents/${PRE_ORG_PATH}" >/dev/null 2>&1 \
    || abort "Org '${ORG}' is not registered in pre: ${PRE_REPO}/${PRE_ORG_PATH}"
  gh repo view "${CLAIMS_REPO}" >/dev/null 2>&1 || abort "Cannot access claims repo: ${CLAIMS_REPO}"
  gh workflow view "${HYDRATE_WORKFLOW}" --repo "${CLAIMS_REPO}" >/dev/null 2>&1 \
    || abort "Workflow '${HYDRATE_WORKFLOW}' not found in ${CLAIMS_REPO}"
  confirm "Use pre org '${ORG}' from ${PRE_REPO} and claims repo ${CLAIMS_REPO}?"
  GUARD_OK=true
  ok "ORG CONTEXT: ${ORG} (${CLAIMS_REPO})"
}

claim_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "${CLAIMS_DIR}" "$1" ;;
  esac
}

ensure_under_claims() {
  local p="$1" dir real_dir real_claims probe tail
  dir="$(dirname "${p}")"
  # Resolve CLAIMS_DIR first (without touching dir) so validation runs before any mkdir.
  mkdir -p "${CLAIMS_DIR}"
  real_claims="$(cd "${CLAIMS_DIR}" && pwd -P)"
  # Canonicalise dir without creating it: walk up to the nearest existing ancestor.
  probe="${dir}"
  tail=""
  while [ ! -d "${probe}" ] && [ "${probe}" != "/" ]; do
    tail="$(basename "${probe}")${tail:+/}${tail}"
    probe="$(dirname "${probe}")"
  done
  real_dir="$(cd "${probe}" && pwd -P)"
  [ -n "${tail}" ] && real_dir="${real_dir}/${tail}"
  case "${real_dir}/" in
    "${real_claims}/"*) ;;
    *) abort "Path must be inside ${CLAIMS_DIR}: ${p}" ;;
  esac
  mkdir -p "${dir}"
}

read_patches() {
  PATCHES=("$@")
  if [ ${#PATCHES[@]} -eq 0 ] && [ ! -t 0 ]; then
    local line
    while IFS= read -r line; do
      [ -n "${line}" ] && PATCHES+=("${line}")
    done
  fi
}

commit_claims() {
  local msg="$1"
  git -C "${CLAIMS_DIR}" add -A
  if git -C "${CLAIMS_DIR}" diff --cached --quiet; then
    warn "No changes to commit"
  else
    git -C "${CLAIMS_DIR}" commit -m "${msg}"
  fi
  git -C "${CLAIMS_DIR}" pull --rebase origin "$(current_branch)"
  git -C "${CLAIMS_DIR}" push
}

current_branch() {
  if [ -d "${CLAIMS_DIR}/.git" ]; then
    git -C "${CLAIMS_DIR}" rev-parse --abbrev-ref HEAD
  else
    read_state branch
  fi
}

checkout_branch() {
  local branch="$1"
  if [ ! -d "${CLAIMS_DIR}/.git" ]; then
    rm -rf "${CLAIMS_DIR}"
    mkdir -p "$(dirname "${CLAIMS_DIR}")"
    gh repo clone "${CLAIMS_REPO}" "${CLAIMS_DIR}"
  fi
  git -C "${CLAIMS_DIR}" fetch origin "${branch}"
  git -C "${CLAIMS_DIR}" checkout "${branch}"
  git -C "${CLAIMS_DIR}" branch --set-upstream-to="origin/${branch}" "${branch}" >/dev/null 2>&1 || true
}

cmd_setup() {
  guard
  local branch base head_sha
  branch="$(read_state branch)"
  if [ -n "${branch}" ]; then
    remote_branch_exists "${branch}" || abort "Saved branch missing on origin: ${branch}. Run cleanup before creating another."
    confirm "Reuse existing smoke branch ${CLAIMS_REPO}@${branch}?"
    checkout_branch "${branch}"
    ok "CLAIMS REPO READY: ${CLAIMS_DIR} on existing branch ${branch}"
    return 0
  fi

  confirm "Clone ${CLAIMS_REPO} into ${CLAIMS_DIR} and create one pushed test branch?"
  branch="test/ia-$(openssl rand -hex 4)"
  base="$(default_branch)"
  head_sha="$(gh api "repos/${CLAIMS_REPO}/git/ref/heads/${base}" --jq '.object.sha')"
  rm -rf "${CLAIMS_DIR}"
  mkdir -p "$(dirname "${CLAIMS_DIR}")"
  gh repo clone "${CLAIMS_REPO}" "${CLAIMS_DIR}"
  gh api "repos/${CLAIMS_REPO}/git/refs" -f ref="refs/heads/${branch}" -f sha="${head_sha}" >/dev/null
  checkout_branch "${branch}"
  save_state branch "${branch}"
  save_state claims_dir "${CLAIMS_DIR}"
  ok "CLAIMS REPO CLONED: ${CLAIMS_DIR} on pushed branch ${branch}"
}

cmd_create() {
  guard
  ensure_patch_tool
  [ -d "${CLAIMS_DIR}/.git" ] || abort "Claims repo missing. Run setup first."
  local source target rel patch_args all
  source="$(claim_path "${1:-}")"; shift || abort "Missing source path"
  target="$(claim_path "${1:-}")"; shift || abort "Missing target path"
  # Auto-append .yaml if target basename has no extension
  case "$(basename "${target}")" in
    *.*) ;; # already has extension
    *) target="${target}.yaml" ;;
  esac
  [ -f "${source}" ] || abort "Source claim not found: ${source}"
  ensure_under_claims "${source}"
  ensure_under_claims "${target}"
  read_patches "$@"
  all=()
  if ! grep -qE '^annotations:' "${source}" 2>/dev/null; then
    all+=( '{"op":"add","path":"/annotations","value":{}}' )
  fi
  all+=( '{"op":"add","path":"/annotations/firestartr.dev~1ia-test","value":"true"}' )
  all+=( "${PATCHES[@]}" )
  patch_args=()
  for p in "${all[@]}"; do patch_args+=(--patch "${p}"); done
  confirm "Create smoke claim ${target#${CLAIMS_DIR}/}?"
  (cd "${REPO_ROOT}" && node "${PATCH_CLAIM}" "${source}" "${patch_args[@]}" --flag clone --result-path "${target}")
  grep -qE "firestartr\\.dev/ia-test:[[:space:]]*['\"']?true['\"']?" "${target}" || abort "Created claim lacks firestartr.dev/ia-test annotation"
  rel="${target#${CLAIMS_DIR}/}"
  commit_claims "ctl-claim: create ${rel}"
  ok "CLAIM CREATED: ${rel}"
}

cmd_patch() {
  guard
  ensure_patch_tool
  [ -d "${CLAIMS_DIR}/.git" ] || abort "Claims repo missing. Run setup first."
  local target rel patch_args
  target="$(claim_path "${1:-}")"; shift || abort "Missing claim path"
  [ -f "${target}" ] || abort "Claim not found: ${target}"
  ensure_under_claims "${target}"
  grep -qE "firestartr\\.dev/ia-test:[[:space:]]*['\"']?true['\"']?" "${target}" \
    || abort "Claim lacks firestartr.dev/ia-test: true. Not created by this skill."
  read_patches "$@"
  [ ${#PATCHES[@]} -gt 0 ] || abort "No patches provided. Pass JSON Patch objects as arguments or pipe one per line."
  patch_args=()
  for p in "${PATCHES[@]}"; do patch_args+=(--patch "${p}"); done
  confirm "Patch smoke claim ${target#${CLAIMS_DIR}/}?"
  (cd "${REPO_ROOT}" && node "${PATCH_CLAIM}" "${target}" "${patch_args[@]}" --flag modify)
  grep -qE "firestartr\\.dev/ia-test:[[:space:]]*['\"']?true['\"']?" "${target}" \
    || abort "Patch removed firestartr.dev/ia-test annotation; aborting before commit."
  rel="${target#${CLAIMS_DIR}/}"
  commit_claims "ctl-claim: patch ${rel}"
  ok "CLAIM PATCHED: ${rel}"
}

resolve_hydrate_workflow() {
  local kind="$1" tfwp_workflow="hydrate-tfworkspace-claim.yaml"
  if [ "${kind}" = "TFWorkspaceClaim" ] \
      && gh workflow view "${tfwp_workflow}" --repo "${CLAIMS_REPO}" >/dev/null 2>&1; then
    echo "${tfwp_workflow}"
  else
    echo "${HYDRATE_WORKFLOW}"
  fi
}

cmd_hydrate() {
  guard
  [ -d "${CLAIMS_DIR}/.git" ] || abort "Claims repo missing. Run setup first."
  local name kind automerge=false branch prev_run run_id pr_url workflow
  name="${1:-}"; shift || abort "Missing claim name"
  kind="${1:-}"; shift || abort "Missing claim kind"
  case "${kind}" in ComponentClaim|UserClaim|GroupClaim|OrgWebhookClaim|TFWorkspaceClaim) ;; *) abort "Invalid claim kind: ${kind}" ;; esac
  while [ $# -gt 0 ]; do
    case "$1" in
      --automerge) automerge=true; shift ;;
      *) abort "Unknown hydrate option: $1" ;;
    esac
  done
  branch="$(current_branch)"
  [ -n "${branch}" ] || abort "No smoke branch found. Run setup first."
  remote_branch_exists "${branch}" || abort "Smoke branch is not pushed: ${branch}"
  workflow="$(resolve_hydrate_workflow "${kind}")"
  confirm "Run hydrate for ${kind}/${name} on ${CLAIMS_REPO}@${branch} via ${workflow}?"
  prev_run="$(gh run list --repo "${CLAIMS_REPO}" --workflow "${workflow}" --branch "${branch}" --json databaseId --jq '.[0].databaseId' --limit 1 2>/dev/null || true)"
  if [ "${kind}" = "TFWorkspaceClaim" ] && [ "${workflow}" != "${HYDRATE_WORKFLOW}" ]; then
    gh workflow run "${workflow}" --repo "${CLAIMS_REPO}" --ref "${branch}" -f name="${name}" -f automerge="${automerge}"
  else
    gh workflow run "${workflow}" --repo "${CLAIMS_REPO}" --ref "${branch}" -f name="${name}" -f kind="${kind}" -f automerge="${automerge}"
  fi
  run_id=""
  for _ in {1..30}; do
    run_id="$(gh run list --repo "${CLAIMS_REPO}" --workflow "${workflow}" --branch "${branch}" --json databaseId --jq '.[0].databaseId' --limit 1)"
    [ -n "${run_id}" ] && [ "${run_id}" != "null" ] && [ "${run_id}" != "${prev_run}" ] && break
    sleep 2
  done
  [ -n "${run_id}" ] && [ "${run_id}" != "null" ] || abort "Could not find hydrate workflow run"
  gh run watch --repo "${CLAIMS_REPO}" "${run_id}"
  pr_url="$(gh run view --repo "${CLAIMS_REPO}" "${run_id}" --log | grep -oE 'https://github.com/[^/ ]+/[^/ ]+/pull/[0-9]+' | head -1 || true)"
  [ -n "${pr_url}" ] || { gh run view --repo "${CLAIMS_REPO}" "${run_id}"; abort "No PR URL found in hydrate logs"; }
  mkdir -p "$(dirname "${LAST_PR_FILE}")"
  echo "${pr_url}" > "${LAST_PR_FILE}"
  save_state hydrate_run_id "${run_id}"
  save_state pr_url "${pr_url}"
  ok "HYDRATE COMPLETE — PR: ${pr_url}"
  cmd_summary "${pr_url}"
}

get_pr_url() {
  if [ -n "${1:-}" ]; then
    echo "$1"
  elif [ -f "${LAST_PR_FILE}" ]; then
    cat "${LAST_PR_FILE}"
  else
    abort "No PR URL provided and ${LAST_PR_FILE} not found"
  fi
}

sum_phrase() {
  local text="$1" phrase="$2"
  printf '%s\n' "${text}" | grep -oiE "[0-9]+ ${phrase}" | awk '{s += $1} END {print s + 0}' || echo 0
}

pr_repo() { echo "$1" | sed -E 's|https://github.com/||; s|/pull/.*||'; }
pr_number() { echo "$1" | grep -oE '/pull/[0-9]+' | grep -oE '[0-9]+' || true; }

pr_comments() {
  local url="$1" repo num
  repo="$(pr_repo "${url}")"
  num="$(pr_number "${url}")"
  [ -n "${repo}" ] && [ -n "${num}" ] || abort "Could not parse PR URL: ${url}"
  gh api "repos/${repo}/issues/${num}/comments" --jq '.[].body' 2>/dev/null || true
}

cmd_summary() {
  guard
  local pr_url
  pr_url="$(get_pr_url "${1:-}")"
  gh pr view "${pr_url}" --json title,state,mergedAt,mergeStateStatus,url,body \
    --template '{{printf "PR SUMMARY: %s\nstate=%s mergeState=%s mergedAt=%s\n\n%s\n" .url .state .mergeStateStatus .mergedAt .body}}'
}

cmd_check() {
  guard
  local pr_url comments created modified destroyed status summary tf_plan_status
  pr_url="$(get_pr_url "${1:-}")"
  comments="$(pr_comments "${pr_url}")"
  created="$(sum_phrase "${comments}" 'to create')"
  modified="$(sum_phrase "${comments}" 'to modify')"
  destroyed="$(sum_phrase "${comments}" 'to destroy')"
  status="degraded"
  summary="No clear apply/destroy signal found"
  tf_plan_status="$(gh api "repos/$(pr_repo "${pr_url}")/commits/$(gh pr view "${pr_url}" --json headRefOid --jq '.headRefOid')/statuses" \
    --jq '[.[] | select(.context == "terraform_plan")] | first | .state' 2>/dev/null || true)"

  if printf '%s\n' "${comments}" | grep -qiE '(^|[^a-z])(error|failed|failure|panic|exception)([^a-z]|$)'; then
    status="failed"
    summary="Errors detected in PR comments"
  elif [ "${tf_plan_status}" = "failure" ]; then
    status="failed"
    summary="terraform_plan status check failed"
  elif printf '%s\n' "${comments}" | grep -qiE 'Apply complete|Resources: [0-9]+ added|Creation complete|Modifications complete|Destroy complete|Destruction complete|Plan: [0-9]+ to add|Plan: [0-9]+ to change|Plan: [0-9]+ to destroy|No changes\. Infrastructure is up-to-date'; then
    status="healthy"
    summary="Lifecycle success signal found"
    [ "${tf_plan_status}" = "success" ] && summary="terraform_plan passed — ${summary}"
  elif [ "${created}" != 0 ] || [ "${modified}" != 0 ] || [ "${destroyed}" != 0 ]; then
    status="healthy"
    summary="Resource changes found and no errors detected"
  fi
  save_state pr_status "${status}"
  printf 'PR STATUS: %s — %s (create=%s modify=%s destroy=%s)\n' "${status}" "${summary}" "${created}" "${modified}" "${destroyed}"
}

cmd_merge() {
  guard
  local pr_url
  pr_url="$(get_pr_url "${1:-}")"
  confirm "Merge ${pr_url}?" true
  gh pr merge "${pr_url}" --squash
  save_state merged_pr "${pr_url}"
  ok "PR MERGED: ${pr_url}"
}

revert_one_pr() {
  local pr_url="$1" state revert_output revert_url
  state="$(gh pr view "${pr_url}" --json state --jq '.state')"
  [ "${state}" = MERGED ] || abort "PR is not merged: ${pr_url} (${state})"
  confirm "Create and merge revert PR for ${pr_url}?" true
  revert_output="$(gh pr revert "${pr_url}" 2>&1)"
  revert_url="$(echo "${revert_output}" | grep -oE 'https://github.com/[^/ ]+/[^/ ]+/pull/[0-9]+' | head -1 || true)"
  [ -n "${revert_url}" ] || abort "Could not extract revert PR URL. Output: ${revert_output}"
  gh pr merge "${revert_url}" --squash
  [ "$(gh pr view "${revert_url}" --json state --jq '.state')" = MERGED ] || abort "Revert PR did not merge: ${revert_url}"
  save_state reverted_pr "${pr_url} via ${revert_url}"
  ok "PR REVERTED: ${pr_url} via ${revert_url}"
  cmd_check "${pr_url}" || warn "Could not check original PR after revert: ${pr_url}"
}

close_one_pr() {
  local pr_url="$1" state
  state="$(gh pr view "${pr_url}" --json state --jq '.state')"
  [ "${state}" = OPEN ] || abort "PR is not open: ${pr_url} (${state})"
  confirm "Close ${pr_url} without merging?" true
  gh pr close "${pr_url}" --comment "Closing smoke-test PR during cleanup."
  save_state closed_pr "${pr_url}"
  ok "PR CLOSED: ${pr_url}"
}

cmd_revert() {
  guard
  if [ $# -eq 0 ]; then
    revert_one_pr "$(get_pr_url "")"
    return 0
  fi
  local pr_url
  for pr_url in "$@"; do
    revert_one_pr "${pr_url}"
  done
}

cmd_close() {
  guard
  if [ $# -eq 0 ]; then
    close_one_pr "$(get_pr_url "")"
    return 0
  fi
  local pr_url
  for pr_url in "$@"; do
    close_one_pr "${pr_url}"
  done
}

cmd_cleanup() {
  local branch
  branch="$(read_state branch)"
  if [ -z "${branch}" ] && [ -d "${CLAIMS_DIR}/.git" ]; then
    branch="$(git -C "${CLAIMS_DIR}" rev-parse --abbrev-ref HEAD)"
  fi
  if [ -n "${branch}" ]; then
    case "${branch}" in
      test/ia-*)
        guard
        confirm "Delete remote smoke branch ${CLAIMS_REPO}@${branch} and remove ${TMP_DIR}?"
        if remote_branch_exists "${branch}"; then
          if git -C "${CLAIMS_DIR}" push origin --delete "${branch}" 2>/dev/null; then
            :
          else
            gh api -X DELETE "repos/${CLAIMS_REPO}/git/refs/heads/${branch}" 2>/dev/null \
              || warn "Could not delete remote branch ${branch}"
          fi
        fi
        ;;
      *) abort "Refusing to cleanup non-smoke branch: ${branch}" ;;
    esac
  else
    confirm "Remove ${TMP_DIR}?"
  fi
  rm -rf "${TMP_DIR}"
  ok "CLEANUP COMPLETE: ${TMP_DIR}"
}

cmd_status() {
  echo "org=${ORG}"
  echo "claims_repo=${CLAIMS_REPO}"
  echo "tmp_dir=${TMP_DIR}"
  if [ -f "${SMOKE_STATE}" ]; then
    cat "${SMOKE_STATE}"
  else
    warn "No state file: ${SMOKE_STATE}"
  fi
  if [ -f "${LAST_PR_FILE}" ]; then
    echo "last_pr_url=$(cat "${LAST_PR_FILE}")"
  fi
}

cmd_full() {
  cmd_setup
  local source target name kind patches=() line input_name
  read -rp "Source claim path (relative to claims repo, e.g. claims/components/source.yaml): " source
  read -rp "Target claim path (relative to claims repo): " target
  echo "Enter JSON patches, one per line. Empty line ends."
  while IFS= read -r line; do
    [ -z "${line}" ] && break
    patches+=("${line}")
  done
  cmd_create "${source}" "${target}" ${patches[@]+"${patches[@]}"}
  name="$(basename "${target}")"
  name="${name%.*}"
  read -rp "Claim name for hydrate [${name}]: " input_name
  name="${input_name:-${name}}"
  read -rp "Claim kind (ComponentClaim/UserClaim/GroupClaim/OrgWebhookClaim/TFWorkspaceClaim): " kind
  cmd_hydrate "${name}" "${kind}"
  cmd_summary
  cmd_merge
  cmd_check
  if [ "${kind}" = "TFWorkspaceClaim" ]; then
    cmd_delete_tfworkspace "${name}"
  else
    cmd_revert
  fi
  cmd_cleanup
}

cmd_delete_tfworkspace() {
  guard
  local name prev_run run_id cr_pr_url claim_pr_url run_log branch
  local -a branch_flag
  name="${1:-}"; shift || abort "Missing claim name"
  [ -n "${name}" ] || abort "Missing claim name"

  gh workflow view "${DELETE_TFWORKSPACE_WORKFLOW}" --repo "${CLAIMS_REPO}" >/dev/null 2>&1 \
    || abort "Workflow '${DELETE_TFWORKSPACE_WORKFLOW}' not found in ${CLAIMS_REPO}"

  confirm "Run delete-tfworkspace for '${name}' in ${CLAIMS_REPO}?" true

  # Use the smoke branch if available so the workflow can find the claim file and scope run polling
  branch="$(read_state branch)"
  branch_flag=()
  [ -n "${branch}" ] && branch_flag=(--branch "${branch}")

  prev_run="$(gh run list --repo "${CLAIMS_REPO}" --workflow "${DELETE_TFWORKSPACE_WORKFLOW}" \
    ${branch_flag[@]+"${branch_flag[@]}"} --json databaseId --jq '.[0].databaseId' --limit 1 2>/dev/null || true)"
  if [ -n "${branch}" ]; then
    gh workflow run "${DELETE_TFWORKSPACE_WORKFLOW}" --repo "${CLAIMS_REPO}" \
      -f name="${name}" -r "${branch}"
  else
    gh workflow run "${DELETE_TFWORKSPACE_WORKFLOW}" --repo "${CLAIMS_REPO}" -f name="${name}"
  fi

  run_id=""
  for _ in {1..30}; do
    run_id="$(gh run list --repo "${CLAIMS_REPO}" --workflow "${DELETE_TFWORKSPACE_WORKFLOW}" \
      ${branch_flag[@]+"${branch_flag[@]}"} --json databaseId --jq '.[0].databaseId' --limit 1 2>/dev/null || true)"
    [ -n "${run_id}" ] && [ "${run_id}" != "null" ] && [ "${run_id}" != "${prev_run}" ] && break
    sleep 2
  done
  [ -n "${run_id}" ] && [ "${run_id}" != "null" ] || abort "Could not find delete workflow run"

  gh run watch --repo "${CLAIMS_REPO}" "${run_id}"

  run_log="$(gh run view --repo "${CLAIMS_REPO}" "${run_id}" --log 2>/dev/null || true)"

  # Extract PR URLs from the Write to workflow job summary step
  # Format: #### CR pull request <url>  and  #### Claim pull request <url>
  cr_pr_url="$(printf '%s\n' "${run_log}" \
    | grep 'CR pull request' | grep -oE 'https://github.com/[^ ]+' | head -1 || true)"
  claim_pr_url="$(printf '%s\n' "${run_log}" \
    | grep 'Claim pull request' | grep -oE 'https://github.com/[^ ]+' | head -1 || true)"

  [ -n "${cr_pr_url}" ] || abort "No CR deletion PR URL found in delete workflow logs"
  [ -n "${claim_pr_url}" ] || abort "No claim deletion PR URL found in delete workflow logs"

  ok "CR deletion PR:    ${cr_pr_url}"
  ok "Claim deletion PR: ${claim_pr_url}"

  confirm "Merge CR deletion PR ${cr_pr_url}?" true
  gh pr merge "${cr_pr_url}" --squash
  ok "CR DELETION PR MERGED: ${cr_pr_url}"

  confirm "Merge claim deletion PR ${claim_pr_url}?" true
  gh pr merge "${claim_pr_url}" --squash
  ok "CLAIM DELETION PR MERGED: ${claim_pr_url}"

  save_state deleted_claim "${name} cr=${cr_pr_url} claim=${claim_pr_url}"
  ok "TFWORKSPACE DELETED: ${name}"
}

cmd_versions() {
  guard
  local image cli
  image="$(gh api "repos/${PRE_REPO}/contents/${PRE_ORG_PATH}/${PRE_ENVIRONMENT}/values.yaml" \
    --jq '.content' | base64 --decode | grep 'ghcr.io.*firestartr' | awk '{print $2}' || true)"
  cli="$(gh variable get FIRESTARTR_CLI_VERSION --repo "${CLAIMS_REPO}" 2>/dev/null || true)"
  printf 'OPERATOR IMAGE: %s\nCLI VERSION: %s\n' "${image:-<unknown>}" "${cli:-<unknown>}"
}

case "${COMMAND}" in
  setup) cmd_setup ${ARGS[@]+"${ARGS[@]}"} ;;
  create) cmd_create ${ARGS[@]+"${ARGS[@]}"} ;;
  patch) cmd_patch ${ARGS[@]+"${ARGS[@]}"} ;;
  hydrate) cmd_hydrate ${ARGS[@]+"${ARGS[@]}"} ;;
  versions) cmd_versions ${ARGS[@]+"${ARGS[@]}"} ;;
  summary) cmd_summary ${ARGS[@]+"${ARGS[@]}"} ;;
  check) cmd_check ${ARGS[@]+"${ARGS[@]}"} ;;
  merge) cmd_merge ${ARGS[@]+"${ARGS[@]}"} ;;
  close) cmd_close ${ARGS[@]+"${ARGS[@]}"} ;;
  revert) cmd_revert ${ARGS[@]+"${ARGS[@]}"} ;;
  delete-tfworkspace) cmd_delete_tfworkspace ${ARGS[@]+"${ARGS[@]}"} ;;
  cleanup) cmd_cleanup ${ARGS[@]+"${ARGS[@]}"} ;;
  full) cmd_full ${ARGS[@]+"${ARGS[@]}"} ;;
  status) cmd_status ${ARGS[@]+"${ARGS[@]}"} ;;
  help) usage ;;
  *) abort "Unknown command: ${COMMAND}" ;;
esac

#!/usr/bin/env bash
set -euo pipefail

NONINTERACTIVE=0
for arg in "$@"; do
  case "$arg" in
    --non-interactive|--noninteractive|-y|--yes) NONINTERACTIVE=1 ;;
    -h|--help)
      printf 'Usage: %s [--non-interactive]\n' "${0##*/}"
      printf '  Interactive wizard by default; --non-interactive runs unattended from .env.\n'
      exit 0 ;;
    *)
      printf 'Unknown argument: %s\n' "$arg" >&2
      exit 2 ;;
  esac
done

interactive() { [[ "$NONINTERACTIVE" -eq 0 ]]; }
interactive || export GIT_TERMINAL_PROMPT=0

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GITOPS_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE="${ENV_FILE:-.env}"
if [[ "$ENV_FILE" == ".env" ]]; then
  ENV_FILE="$SCRIPT_DIR/.env"
elif [[ "$ENV_FILE" != /* ]]; then
  ENV_FILE="$GITOPS_DIR/$ENV_FILE"
fi

GITOPS_REPO="firestartr-pro/firestartr"
APP_REPO="firestartr-pre/app-firestartr"
STAGE_INDEX=0
TOTAL_STAGES=5
WRITTEN_ENV=()

clear_screen() {
  interactive || return 0
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

say() { printf '  %s\n' "$1"; }
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

pause() {
  interactive || return 0
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

confirm() {
  interactive || return 0
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

open_url() {
  local url="$1"
  printf '  %s↗%s %s\n' "$GREEN" "$RESET" "$url"
  interactive || return 0
  { if command -v wslview >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open >/dev/null 2>&1; then open "$url"
    else warn "couldn't open a browser — visit it manually: $url"; fi
  } >/dev/null 2>&1 || warn "couldn't open a browser — visit it manually: $url"
}

banner() {
  clear_screen
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  if interactive; then
    printf '%s  You drive the browser; this wizard remembers values in %s.%s\n' "$DIM" "$ENV_FILE" "$RESET"
  else
    printf '%s  Runs unattended from %s; no browser, prompts, or rollout wait.%s\n' "$DIM" "$ENV_FILE" "$RESET"
  fi
  printf '\n'
  pause "Ready to start?"
}

stage() {
  clear_screen
  STAGE_INDEX=$((STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' "$BOLD" "$BLUE" "$STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

finish() {
  clear_screen
  printf '\n%s%s  ✓ Setup complete%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} )) && note "wrote ${#WRITTEN_ENV[@]} value(s) to $ENV_FILE: ${WRITTEN_ENV[*]}"
  printf '\n'
}

existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line
  line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  printf '%s' "${line#*=}"
}

env_default() {
  local key="$1" fallback="$2" value
  value=$(existing "$key" || true)
  printf '%s' "${value:-$fallback}"
}

read_visible() {
  local var="$1"
  if [[ -t 0 ]]; then read -e -r "${var?}" || true; else read -r "${var?}" || true; fi
}

ask_default() {
  local key="$1" prompt="$2" fallback="$3" current input
  current="${!key:-}"
  [[ -z "$current" ]] && current=$(existing "$key" || true)
  [[ -z "$current" ]] && current="$fallback"
  if ! interactive; then
    printf -v "$key" '%s' "$current"
    printf '  %s%s%s %s%s%s\n' "$BOLD" "$prompt" "$RESET" "$DIM" "${current:-<unset>}" "$RESET"
    return 0
  fi
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[%s]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$current" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read_visible input
  [[ -z "$input" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

write_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

docker_tag_component_is_valid() {
  local value="$1"
  [[ "$value" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]]
}

snapshot_branch_short_sha() {
  local branch="$1" sha=""
  if command -v gh >/dev/null 2>&1; then
    sha=$(gh api "repos/$GITOPS_REPO/git/ref/heads/$branch" --jq '.object.sha[0:7]' 2>/dev/null || true)
  fi
  if [[ -z "$sha" ]]; then
    sha=$(git ls-remote --heads "https://github.com/$GITOPS_REPO.git" "$branch" 2>/dev/null | awk 'NR == 1 {print substr($1, 1, 7)}' || true)
  fi
  printf '%s' "$sha"
}

prepare_app_repo() {
  mkdir -p "$(dirname "$APP_DIR")"
  if [[ -d "$APP_DIR/.git" ]]; then
    if git -C "$APP_DIR" fetch origin main --quiet \
      && git -C "$APP_DIR" checkout main --quiet \
      && git -C "$APP_DIR" pull --ff-only --quiet; then
      printf '  %s✓%s updated %s\n' "$GREEN" "$RESET" "$APP_REPO"
    else
      warn "couldn't fast-forward $APP_DIR — sort out its git state, then re-run"
      exit 1
    fi
  elif [[ -e "$APP_DIR" ]]; then
    warn "$APP_DIR exists but is not a git clone — choose another APP_DIR"
    exit 1
  elif command -v gh >/dev/null 2>&1; then
    gh repo clone "$APP_REPO" "$APP_DIR" -- --quiet
  else
    git clone --quiet "https://github.com/$APP_REPO.git" "$APP_DIR"
  fi
}

cleanup_app_repo() {
  [[ "${APP_DIR_CLEANUP:-yes}" == "yes" ]] || return 0
  [[ -d "$APP_DIR/.git" ]] || return 0
  local remote
  remote=$(git -C "$APP_DIR" remote get-url origin 2>/dev/null || true)
  if [[ "$remote" != *"$APP_REPO"* && "$remote" != *"$APP_REPO.git"* ]]; then
    warn "leaving $APP_DIR in place — origin is not $APP_REPO"
    return 0
  fi
  if ! git -C "$APP_DIR" diff --quiet || ! git -C "$APP_DIR" diff --cached --quiet; then
    warn "leaving dirty app repo at $APP_DIR"
    return 0
  fi
  rm -rf -- "$APP_DIR"
  printf '  %s✓ removed%s %s\n' "$GREEN" "$RESET" "$APP_DIR"
}

snapshot_tag_exists() {
  local tag="$1" gh_token token code netrc
  gh_token=$(gh auth token 2>/dev/null) || return 2
  netrc=$(mktemp) || return 2
  chmod 600 "$netrc" || { rm -f -- "$netrc"; return 2; }
  printf 'machine ghcr.io\n  login x\n  password %s\n' "$gh_token" > "$netrc"
  token=$(curl -sS --netrc-file "$netrc" \
    "https://ghcr.io/token?scope=repository:prefapp/gitops-k8s:pull&service=ghcr.io" 2>/dev/null \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null || true)
  rm -f -- "$netrc"
  [[ -n "$token" ]] || return 2
  code=$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $token" \
    -H "Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json" \
    "https://ghcr.io/v2/prefapp/gitops-k8s/manifests/$tag" 2>/dev/null || true)
  [[ "$code" == "200" ]]
}

merge_deployment_pr() {
  local head="kubernetes-${PLATFORM}-${TENANT}-${ENVIRONMENT}" pr="" url=""
  say "Finding the deployment PR ($head -> deployment)..."
  for ((attempt=1; attempt<=30; attempt++)); do
    pr=$(gh pr list -R "$APP_REPO" --head "$head" --base deployment --state open \
      --json number --jq '.[0].number // empty' 2>/dev/null || true)
    [[ -n "$pr" ]] && break
    sleep 4
  done
  if [[ -z "$pr" ]]; then
    warn "deployment PR ($head) never appeared"
    return 1
  fi
  url=$(gh pr view "$pr" -R "$APP_REPO" --json url --jq .url 2>/dev/null || true)
  open_url "${url:-https://github.com/$APP_REPO/pull/$pr}"
  if gh pr merge "$pr" -R "$APP_REPO" --squash; then
    printf '  %s✓ merged%s deployment PR #%s\n' "$GREEN" "$RESET" "$pr"
  else
    warn "failed to merge deployment PR #$pr"
    return 1
  fi
}

[[ "$NONINTERACTIVE" -eq 0 || -f "$ENV_FILE" ]] || {
  warn "non-interactive mode needs $ENV_FILE - copy .env.example to .env and fill it in"
  exit 1
}
mkdir -p "$(dirname "$ENV_FILE")"

APP_DIR="${APP_DIR:-$(env_default APP_DIR "$GITOPS_DIR/tmp/app-firestartr")}"
APP_DIR_CLEANUP="${APP_DIR_CLEANUP:-$(env_default APP_DIR_CLEANUP yes)}"
IMAGE_FLAVOR="${IMAGE_FLAVOR:-$(env_default IMAGE_FLAVOR full-aws)}"

banner "Test operator changes on a firestartr-pre org (via snapshot image)"

stage "Target org & prerequisites"
say "We test on one PRE org: platform / tenant / environment."
say "Example: firestartr-pre / prefapp-demo / pre"
missing_bins=()
for bin in gh git python3 curl; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    warn "missing '$bin' — install it before continuing"
    missing_bins+=("$bin")
  fi
done
if (( ${#missing_bins[@]} )); then
  warn "required tools missing: ${missing_bins[*]}"
  exit 1
fi
ask_default PLATFORM "Platform:" "firestartr-pre"
ask_default TENANT "Tenant:" "prefapp-demo"
ask_default ENVIRONMENT "Environment:" "pre"
ask_default APP_DIR "Temporary app-firestartr clone path:" "$APP_DIR"
[[ "$APP_DIR" = /* ]] || APP_DIR="$GITOPS_DIR/$APP_DIR"
for target_part_name in PLATFORM TENANT ENVIRONMENT; do
  target_part="${!target_part_name}"
  if [[ "$target_part" == */* || "$target_part" == *..* ]]; then
    warn "$target_part_name must not contain '/' or '..'"
    exit 1
  fi
done
if ! interactive && [[ "$PLATFORM" != "firestartr-pre" || "$ENVIRONMENT" != "pre" ]]; then
  warn "non-interactive mode is restricted to PLATFORM=firestartr-pre and ENVIRONMENT=pre"
  exit 1
fi
write_env PLATFORM "$PLATFORM"
write_env TENANT "$TENANT"
write_env ENVIRONMENT "$ENVIRONMENT"
write_env APP_DIR "$APP_DIR"

VALUES_REL="kubernetes/$PLATFORM/$TENANT/$ENVIRONMENT/values.yaml"
VALUES_FILE="$APP_DIR/$VALUES_REL"
if ! docker_tag_component_is_valid "$IMAGE_FLAVOR"; then
  warn "IMAGE_FLAVOR must contain only Docker tag-safe characters: letters, numbers, '_', '.', '-'"
  exit 1
fi
note "snapshot flavor: $IMAGE_FLAVOR"
pause "Target confirmed — continue?"

stage "Build the snapshot image"
say "Builds the selected flavor from your branch's HEAD."
LOCAL_BRANCH=$(git -C "$GITOPS_DIR" branch --show-current 2>/dev/null || true)
ask_default SNAPSHOT_BRANCH "Branch to build a snapshot from:" "${LOCAL_BRANCH:-main}"
if interactive; then
  write_env SNAPSHOT_BRANCH "$SNAPSHOT_BRANCH"
fi
AUTO_VERSION=$(snapshot_branch_short_sha "$SNAPSHOT_BRANCH" || true)
while true; do
  ask_default SNAPSHOT_VERSION "Snapshot version (short sha):" "$AUTO_VERSION"
  if ! docker_tag_component_is_valid "$SNAPSHOT_VERSION" || (( ${#SNAPSHOT_VERSION} + ${#IMAGE_FLAVOR} + 1 > 128 )); then
    warn "SNAPSHOT_VERSION must produce a valid Docker tag with IMAGE_FLAVOR"
    interactive || exit 1
    SNAPSHOT_VERSION=""
    AUTO_VERSION=""
    continue
  fi
  NEW_IMG="ghcr.io/prefapp/gitops-k8s:${SNAPSHOT_VERSION}_${IMAGE_FLAVOR}"
  say "New image → $NEW_IMG"
  confirm "Is that the right image tag for '$SNAPSHOT_BRANCH'?" && break
  SNAPSHOT_VERSION=""
  AUTO_VERSION=""
  warn "No problem — paste the corrected version."
done
if ! interactive && [[ -z "$SNAPSHOT_VERSION" ]]; then
  warn "couldn't determine a snapshot version for '$SNAPSHOT_BRANCH'"
  exit 1
fi
if interactive; then
  write_env SNAPSHOT_VERSION "$SNAPSHOT_VERSION"
fi
if confirm "Dispatch 'Build Docker snapshots' for '$SNAPSHOT_BRANCH' now?"; then
  if gh workflow run build_docker_snapshots.yaml -R "$GITOPS_REPO" \
    --ref "$SNAPSHOT_BRANCH" -f from="$SNAPSHOT_BRANCH" -f flavors="$IMAGE_FLAVOR"; then
    printf '  %s✓ dispatched%s\n' "$GREEN" "$RESET"
  else
    warn "dispatch failed — check 'gh auth status' and the branch name"
    interactive || exit 1
  fi
else
  note "skipped dispatch — will verify against the predicted snapshot tag"
fi

stage "Update the org's operator image"
say "Rewrites the 'image:' line in the org's values.yaml and pushes to main while the image builds."
say "Preparing a fresh $APP_REPO main checkout at ${APP_DIR}…"
prepare_app_repo
if [[ ! -f "$VALUES_FILE" ]]; then
  warn "values.yaml missing at $VALUES_FILE — fix the target and re-run"
  exit 1
fi
CURRENT_IMG=$(awk '$1 == "image:" && $2 ~ /^ghcr\.io\/prefapp\/gitops-k8s:/ { print $2; exit }' "$VALUES_FILE" 2>/dev/null || true)
note "current image: ${CURRENT_IMG:-<none found>}"
tmp=$(mktemp)
sed -E "s|^([[:space:]]*image:[[:space:]]*)ghcr.io/prefapp/gitops-k8s:[^[:space:]]+|\1$NEW_IMG|" "$VALUES_FILE" > "$tmp" && mv "$tmp" "$VALUES_FILE"
if ! awk -v expected="$NEW_IMG" '$1 == "image:" && $2 == expected { found=1 } END { exit(found ? 0 : 1) }' "$VALUES_FILE"; then
  warn "failed to update image in $VALUES_FILE"
  exit 1
fi
printf '  %s✓ set image to%s %s\n' "$GREEN" "$RESET" "$NEW_IMG"
git -C "$APP_DIR" --no-pager diff -- "$VALUES_REL" || true
if git -C "$APP_DIR" diff --quiet -- "$VALUES_REL"; then
  note "no commit needed — values.yaml already has that image"
else
  git -C "$APP_DIR" add "$VALUES_REL"
  git -C "$APP_DIR" commit -m "test($TENANT): operator snapshot ${SNAPSHOT_VERSION}_${IMAGE_FLAVOR}" --quiet
  if git -C "$APP_DIR" push origin main; then
    printf '  %s✓ pushed%s\n' "$GREEN" "$RESET"
  else
    warn "push failed — leaving $APP_DIR in place so you can resolve it"
    exit 1
  fi
fi
cleanup_app_repo

stage "Generate the deployment"
say "Runs the hydrate orchestrator → opens/updates the deployment PR ArgoCD watches."
if confirm "Dispatch 'generate-deployment-kubernetes' for $PLATFORM/$TENANT/$ENVIRONMENT?"; then
  if gh workflow run generate-deployment-kubernetes.yml -R "$APP_REPO" \
    -f platform="$PLATFORM" -f tenant="$TENANT" -f environment="$ENVIRONMENT"; then
    printf '  %s✓ dispatched%s\n' "$GREEN" "$RESET"
  else
    warn "dispatch failed — check gh auth and inputs"
    interactive || exit 1
  fi
  sleep 4
  DRUN=$(gh run list -R "$APP_REPO" --workflow generate-deployment-kubernetes.yml \
    -L 1 --json url --jq '.[0].url // empty' 2>/dev/null || true)
  [[ -n "$DRUN" ]] && open_url "$DRUN"
fi
if interactive; then
  step "Use the opened action run to find, review, and MERGE the deployment PR."
  step "ArgoCD can retry pulling the image until the snapshot tag exists."
  pause "Deployment PR merged — continue to verify?"
else
  merge_deployment_pr || exit 1
fi

stage "Verify the snapshot image exists"
say "Polls GHCR for tag ${SNAPSHOT_VERSION}_$IMAGE_FLAVOR while rollout can already be queued."
SNAPSHOT_TAG="${SNAPSHOT_VERSION}_$IMAGE_FLAVOR"
TAG_FOUND=""
for ((attempt=1; attempt<=80; attempt++)); do
  if snapshot_tag_exists "$SNAPSHOT_TAG"; then TAG_FOUND=1; break; fi
  rc=$?
  [[ "$rc" == "2" ]] && { warn "couldn't get a GHCR pull token — check gh auth"; break; }
  sleep 15
done
if [[ -n "$TAG_FOUND" ]]; then
  printf '  %s✓ snapshot exists%s %s\n' "$GREEN" "$RESET" "$NEW_IMG"
else
  warn "couldn't confirm $NEW_IMG in GHCR"
  interactive || exit 1
  confirm "Continue without automatic confirmation?" || exit 1
fi

if interactive; then
  say "Wait for ArgoCD to roll out $NEW_IMG, then verify the operator image yourself."
  say "Now render + apply a Claim against this org to test your operator changes."
fi

finish

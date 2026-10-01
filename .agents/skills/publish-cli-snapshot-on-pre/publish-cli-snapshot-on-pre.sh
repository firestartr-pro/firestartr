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
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GITOPS_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE="${ENV_FILE:-.env}"
if [[ "$ENV_FILE" == ".env" ]]; then
  ENV_FILE="$SCRIPT_DIR/.env"
elif [[ "$ENV_FILE" != /* ]]; then
  ENV_FILE="$GITOPS_DIR/$ENV_FILE"
fi

GITOPS_REPO="prefapp/gitops-k8s"
WORKFLOW="npm_publish_cli.yaml"
STAGE_INDEX=0
TOTAL_STAGES=4
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
fail() { printf '  %s✖ %s%s\n' "$RED" "$1" "$RESET"; }

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

# --- Core logic ---

get_next_minor_base() {
  local version
  version=$(npm view @firestartr/cli version 2>/dev/null || true)
  if [[ -z "$version" ]]; then
    version=$(gh release list -R "$GITOPS_REPO" -L 5 --json tagName \
      --jq '[.[].tagName | select(test("^v?\\\\d+\\\\.\\\\d+\\\\.\\\\d+$")) | ltrimstr("v")][0]' 2>/dev/null || true)
  fi
  if [[ -z "$version" ]]; then
    return 1
  fi
  printf '%s' "$version" | python3 -c "
import sys
parts = sys.stdin.read().strip().split('.')
y = int(parts[1]) + 1
print(f'{parts[0]}.{y}.0')
" 2>/dev/null || return 1
}

fetch_previous_snapshot_runs() {
  local motive="$1"
  gh run list -R "$GITOPS_REPO" --workflow "$WORKFLOW" --limit 100 \
    --json displayTitle --jq '.[].displayTitle' 2>/dev/null || true
}

compute_incremental() {
  local motive="$1" max_n=0
  while IFS= read -r title; do
    [[ -z "$title" ]] && continue
    # Match: "Publishing cli at {X.Y.Z}-snapshot-{motive}-{N} version"
    local n=''
    [[ "$title" =~ snapshot-${motive}-([0-9]+)\ version$ ]] && n="${BASH_REMATCH[1]}"
    [[ -n "$n" && "$n" -gt "$max_n" ]] && max_n="$n"
  done
  printf '%s' $((max_n + 1))
}

publish_version_is_valid() {
  local value="$1"
  # Must be a valid SemVer (npm semver.valid) — underscores/spaces are not allowed
  [[ "$value" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]]
}

[[ "$NONINTERACTIVE" -eq 0 || -f "$ENV_FILE" ]] || {
  warn "non-interactive mode needs $ENV_FILE - copy .env.example to .env and fill it in"
  exit 1
}
mkdir -p "$(dirname "$ENV_FILE")"

banner "Publish CLI snapshot to a firestartr-pre org"

# === Stage 1: Target org & prerequisites ===
stage "Target org & prerequisites"
say "We publish the CLI snapshot and update one PRE org's variable."
say "Example: firestartr-pre / prefapp-demo / pre"
missing_bins=()
for bin in gh git python3; do
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
TARGET_ORG="$TENANT"
write_env PLATFORM "$PLATFORM"
write_env TENANT "$TENANT"
write_env ENVIRONMENT "$ENVIRONMENT"
note "target GitHub org: $TARGET_ORG"
pause "Target confirmed — continue?"

# === Stage 2: Branch, motive & version calculation ===
stage "Branch, motive & snapshot version"
say "Build from a branch and compute the snapshot version."
LOCAL_BRANCH=$(git -C "$GITOPS_DIR" branch --show-current 2>/dev/null || true)
ask_default SNAPSHOT_BRANCH "Branch to publish from:" "${LOCAL_BRANCH:-main}"
if interactive; then
  write_env SNAPSHOT_BRANCH "$SNAPSHOT_BRANCH"
fi

BASE_VERSION=$(get_next_minor_base || true)
if [[ -z "$BASE_VERSION" ]]; then
  warn "couldn't determine latest release version from npm or gh releases"
  if interactive; then
    ask_default BASE_VERSION "Fallback base version (X.Y.0):" ""
    [[ -z "$BASE_VERSION" ]] && exit 1
  else
    exit 1
  fi
fi
ask_default BASE_VERSION "Base version (next minor):" "$BASE_VERSION"
note "base version: $BASE_VERSION"

ask_default SNAPSHOT_MOTIVE "Motive (short description, e.g. 'fix-queue'):" ""
if [[ -z "$SNAPSHOT_MOTIVE" ]]; then
  warn "a motive is required to name the snapshot"
  exit 1
fi
SNAPSHOT_MOTIVE="$(printf '%s' "$SNAPSHOT_MOTIVE" | sed 's/[^A-Za-z0-9-]/-/g')"
write_env SNAPSHOT_MOTIVE "$SNAPSHOT_MOTIVE"

VERSION_PREFIX="${BASE_VERSION}-snapshot-${SNAPSHOT_MOTIVE}"
INCREMENTAL=$(fetch_previous_snapshot_runs "$SNAPSHOT_MOTIVE" | compute_incremental "$SNAPSHOT_MOTIVE")
SNAPSHOT_VERSION="${VERSION_PREFIX}-${INCREMENTAL}"
note "snapshot version: $SNAPSHOT_VERSION"
if ! publish_version_is_valid "$SNAPSHOT_VERSION"; then
  warn "computed snapshot version '$SNAPSHOT_VERSION' is not valid"
  exit 1
fi
if interactive; then
  write_env SNAPSHOT_VERSION "$SNAPSHOT_VERSION"
fi
say "Will publish: @firestartr/cli@${SNAPSHOT_VERSION}"
pause "Version confirmed — continue?"

# === Stage 3: Dispatch npm publish workflow ===
stage "Dispatch npm publish"
say "Dispatches $WORKFLOW on $GITOPS_REPO at branch $SNAPSHOT_BRANCH"
if confirm "Dispatch 'NPM publish CLI' for '$SNAPSHOT_BRANCH' now?"; then
  if gh workflow run "$WORKFLOW" -R "$GITOPS_REPO" \
    --ref "$SNAPSHOT_BRANCH" -f version="$SNAPSHOT_VERSION" -f create-pr=false; then
    printf '  %s✓ dispatched%s\n' "$GREEN" "$RESET"
    RUN_URL=$(gh run list -R "$GITOPS_REPO" --workflow "$WORKFLOW" -L 1 \
      --json url --jq '.[0].url // empty' 2>/dev/null || true)
    [[ -n "$RUN_URL" ]] && note "workflow run: $RUN_URL"
    if ! interactive; then
      RUN_ID="${RUN_URL##*/}"
      if [[ -z "$RUN_URL" || ! "$RUN_ID" =~ ^[0-9]+$ ]]; then
        warn "couldn't determine workflow run id to wait for completion"
        exit 1
      fi
      say "Waiting for workflow run to complete..."
      gh run watch "$RUN_ID" -R "$GITOPS_REPO" --exit-status
    fi
  else
    warn "dispatch failed — check 'gh auth status' and the branch name"
    interactive || exit 1
  fi
else
  warn "dispatch skipped — no snapshot will be published"
  exit 1
fi

# === Stage 4: Update GitHub org variable ===
stage "Update org variable"
say "Sets FIRESTARTR_CLI_VERSION to $SNAPSHOT_VERSION on org $TARGET_ORG"
if confirm "Set org variable 'FIRESTARTR_CLI_VERSION=$SNAPSHOT_VERSION' on '$TARGET_ORG'?"; then
  CURRENT_VAL=$(gh variable get FIRESTARTR_CLI_VERSION --org "$TARGET_ORG" 2>/dev/null || true)
  note "current value: ${CURRENT_VAL:-<not set>}"
  if gh variable set FIRESTARTR_CLI_VERSION --org "$TARGET_ORG" --body "$SNAPSHOT_VERSION"; then
    printf '  %s✓ set%s FIRESTARTR_CLI_VERSION → %s on %s\n' "$GREEN" "$RESET" "$SNAPSHOT_VERSION" "$TARGET_ORG"
  else
    warn "failed to set FIRESTARTR_CLI_VERSION on org $TARGET_ORG"
    warn "ensure 'gh auth' has org-level write:variable permissions"
    interactive || exit 1
  fi
else
  warn "skipped org variable update"
fi

finish
printf '\n%s  Summary%s\n' "$BOLD" "$RESET"
printf '  Branch:        %s\n' "$SNAPSHOT_BRANCH"
printf '  Snapshot:      %s\n' "$SNAPSHOT_VERSION"
printf '  Target org:    %s\n' "$TARGET_ORG"
printf '  Published via: %s\n' "$RUN_URL"
printf '\n'

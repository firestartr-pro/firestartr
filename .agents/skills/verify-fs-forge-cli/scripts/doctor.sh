#!/usr/bin/env bash
# Check that a drive can be trusted. Makes no GitHub call.
# Usage: doctor.sh [--org <org>]    (--org adds the org-bound readiness checks)
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() { echo "usage: $(basename "$0") [--org <org>]" >&2; exit 2; }
org=""
case "${1:-}" in
  "") ;;
  --org)
    [ $# -eq 2 ] || usage
    [ -n "${2:-}" ] || usage
    org="$2"
    ;;
  *) usage ;;
esac

failed=0
pass() { echo "PASS $1: $2"; }
warn() { echo "WARN $1: $2"; }
fail() { echo "FAIL $1: $2"; failed=1; }

fsf_resolve_node 2>/dev/null && pass node "$(node -v) at $(command -v node)" || fail node "node >=22 not found"

# The build must be current, or the drive verifies old code.
kinds_js="$FSF_PKG/dist/commands/kinds.js"
if [ ! -f "$kinds_js" ]; then
  fail build "dist/ is missing; run scripts/launch.sh"
elif [ -n "$(find "$FSF_PKG/src" "$FSF_PKG/schemas" \( -name '*.ts' -o -name '*.json' \) -newer "$kinds_js" | head -n 1)" ]; then
  fail build "src/ or schemas/ is newer than dist/; run scripts/launch.sh"
else
  pass build "dist/ is newer than every src/*.ts and schemas/*.json"
fi

if version="$(node "$FSF_BIN" --version 2>&1)"; then
  pass cli "$version"
else
  fail cli "--version failed: $version"
fi

count="$(node "$FSF_BIN" kinds --json 2>/dev/null | jq 'length' 2>/dev/null || echo 0)"
[ "$count" -ge 1 ] && pass kinds "$count claim kinds registered" || fail kinds "kinds --json returned no kinds"

# The canary must block and record, or an "offline" verdict means nothing.
probe_log="$(mktemp)"
FSF_CANARY=strict FSF_CANARY_LOG="$probe_log" NODE_OPTIONS="--require $FSF_CANARY_JS" \
  node -e "fetch('https://example.com').then(() => process.exit(3), () => process.exit(0))"
probe_exit=$?
if [ "$probe_exit" = 0 ] && grep -q '"blocked":true' "$probe_log"; then
  pass canary "blocks and logs an outbound connect"
else
  fail canary "outbound probe was not blocked and logged (exit $probe_exit)"
fi
rm -f "$probe_log"

# The write guards must refuse before anything runs.
drive="$FSF_SKILL_DIR/scripts/drive.sh"
"$drive" -- create domain --name x --description y --owner group:z --commit >/dev/null 2>&1
[ $? = 2 ] && pass guard-commit "drive.sh refuses --commit outside --mode write" || fail guard-commit "drive.sh let --commit through in offline mode"
"$drive" --mode read -- kinds >/dev/null 2>&1
[ $? = 2 ] && pass guard-org "drive.sh refuses an org-bound drive with no --org" || fail guard-org "drive.sh ran an org-bound drive without a named org"
# app apply writes without --commit, so only --mode write may run it. The probe
# asserts the guard's own message, not just exit 2: a missing run dir or an
# unreadable snapshot also exits 2, so a guard that silently disappeared would
# still pass. oclif resolves both `app apply` and its colon form, so both are
# probed; FSF_RUN names no run and the stand-in gh exits 97, so a missing guard
# reaches neither the CLI nor GitHub.
guard_probe="$(mktemp -d)"
mkdir -p "$guard_probe/bin"
printf '#!/bin/sh\necho "doctor guard probe: gh must not be reached" >&2\nexit 97\n' > "$guard_probe/bin/gh"
chmod +x "$guard_probe/bin/gh"
app_guard_refused() { # <expected refusal> <drive args...>
  local message="$1" out status
  shift
  out="$(FSF_HOME="$guard_probe" FSF_RUN="$guard_probe/no-run" PATH="$guard_probe/bin:$PATH" \
    GH_TOKEN=doctor-guard-probe GITHUB_TOKEN=doctor-guard-probe "$drive" "$@" 2>&1)"
  status=$?
  [ "$status" = 2 ] && [[ "$out" == *"$message"* ]]
}
app_guard_check() { # <check> <when> <expected refusal> <drive args...>
  local check="$1" when="$2" message="$3" missed="" form
  local -a app_args
  shift 3
  for form in "app apply" "app:apply"; do
    read -r -a app_args <<< "$form --inputs inputs.yaml"
    app_guard_refused "$message" "$@" -- "${app_args[@]}" || missed="$missed $form"
  done
  if [ -z "$missed" ]; then
    pass "$check" "drive.sh refuses app apply and app:apply $when"
  else
    fail "$check" "drive.sh did not refuse$missed with its app apply guard $when"
  fi
}
app_guard_check guard-app-offline "outside --mode write" \
  "app apply needs --mode write with an explicitly named pre org"
app_guard_check guard-app-read "in read mode" \
  "app apply writes without --commit; drive it with --mode write" \
  --mode read --org fsf-guard-test
rm -rf "$guard_probe"

guard_dir="$(mktemp -d)"
mkdir -p "$guard_dir/bin" "$guard_dir/verify-fs-forge-cli/run/evidence" "$guard_dir/verify-fs-forge-cli/run/work"
printf '#!/bin/sh\nexit 97\n' > "$guard_dir/bin/gh"
chmod +x "$guard_dir/bin/gh"
printf 'organizations:\n  - name: fsf-guard-test\n    paths: [/nowhere]\n    claims_repo: production/claims\n' > "$guard_dir/config.yaml"
for guard_mode in read write; do
  guard_args=()
  [ "$guard_mode" = read ] || guard_args+=(--commit)
  guard_output="$(FSF_HOME="$guard_dir" FSF_RUN="$guard_dir/verify-fs-forge-cli/run" \
    PATH="$guard_dir/bin:$PATH" GH_TOKEN=fsf-guard-token GITHUB_TOKEN=fsf-guard-token \
    "$drive" --mode "$guard_mode" --org fsf-guard-test \
    --seed "$guard_dir/config.yaml=.xdg/config/fs-forge/config.yaml" \
    -- delete component guard-test "${guard_args[@]}" 2>&1)"
  guard_exit=$?
  if [ "$guard_exit" = 2 ] && [[ "$guard_output" == *"repository overrides"* ]]; then
    pass "guard-config-$guard_mode" "refuses cross-owner repository overrides before authentication or execution"
  else
    fail "guard-config-$guard_mode" "did not refuse cross-owner overrides (exit $guard_exit)"
  fi
done
rm -rf "$guard_dir"

# Compare physical paths: a '../' detour or a symlink can hide the real target,
# so create the directory, resolve it, and only then check it is outside the repo.
real_repo="$(cd "$FSF_REPO" && pwd -P)"
if ! mkdir -p "$FSF_HOME" 2>/dev/null; then
  fail evidence-dir "$FSF_HOME is not writable"
else
  real_home="$(cd "$FSF_HOME" && pwd -P)" || real_home=""
  case "$real_home" in
    "") fail evidence-dir "$FSF_HOME could not be resolved" ;;
    "$real_repo"|"$real_repo"/*) fail evidence-dir "$real_home is inside the repo; set FSF_HOME outside it" ;;
    *) [ -w "$real_home" ] && pass evidence-dir "$real_home is writable and outside the repo" || fail evidence-dir "$real_home is not writable" ;;
  esac
fi

command -v jq >/dev/null 2>&1 && pass jq "$(command -v jq)" || fail jq "jq is required by org-snapshot.sh and this script"

for var in GITHUB_TOKEN GH_TOKEN FSCRT_ORG FS_FORGE_FEATURE_CACHE_DIR; do
  [ -z "${!var:-}" ] || warn env "$var is set here; drive.sh scrubs it in offline mode and sets its own values otherwise"
done

if [ -n "$org" ]; then
  if fsf_token >/dev/null; then pass token "GH_TOKEN, GITHUB_TOKEN or 'gh auth token' yields a token"; else fail token "no GH_TOKEN, GITHUB_TOKEN or 'gh auth token'"; fi
  command -v gh >/dev/null 2>&1 && pass gh "$(command -v gh)" || fail gh "gh is required by org-snapshot.sh and write mode"
  pass org "named explicitly: $org (not contacted)"
fi

[ "$failed" = 0 ] && echo "DOCTOR OK" || { echo "DOCTOR FAILED"; exit 1; }

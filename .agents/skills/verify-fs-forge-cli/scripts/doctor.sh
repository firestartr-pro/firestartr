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

case "$FSF_HOME" in
  "$FSF_REPO"/*) fail evidence-dir "$FSF_HOME is inside the repo; set FSF_HOME outside it" ;;
  *) mkdir -p "$FSF_HOME" && [ -w "$FSF_HOME" ] && pass evidence-dir "$FSF_HOME is writable and outside the repo" || fail evidence-dir "$FSF_HOME is not writable" ;;
esac

command -v jq >/dev/null 2>&1 && pass jq "$(command -v jq)" || fail jq "jq is required by org-snapshot.sh and this script"

for var in GITHUB_TOKEN GH_TOKEN FSCRT_ORG FS_FORGE_FEATURE_CACHE_DIR; do
  [ -z "${!var:-}" ] || warn env "$var is set here; drive.sh scrubs it in offline mode and sets its own values otherwise"
done

if [ -n "$org" ]; then
  if fsf_token >/dev/null; then pass token "GITHUB_TOKEN or 'gh auth token' yields a token"; else fail token "no GITHUB_TOKEN and 'gh auth token' failed"; fi
  command -v gh >/dev/null 2>&1 && pass gh "$(command -v gh)" || fail gh "gh is required by org-snapshot.sh and write mode"
  pass org "named explicitly: $org (not contacted)"
fi

[ "$failed" = 0 ] && echo "DOCTOR OK" || { echo "DOCTOR FAILED"; exit 1; }

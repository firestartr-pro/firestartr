#!/usr/bin/env bash
# Run one fs-forge command in its own working directory and capture evidence.
#
# Usage:
#   drive.sh [--label L] [--mode offline|read|write] [--org ORG] [--expect-exit N]
#            [--seed SRC[=DEST]]... -- <fs-forge args>
#
# Modes (offline is the default):
#   offline  no token, no org, outbound connects blocked. Any attempted connect
#            fails the drive, even if the command exited as expected.
#   read     needs --org ORG. Token set, connects logged, --commit refused. The
#            drive fails if fs-forge/* branches, PRs or workflow runs changed.
#   write    needs --org ORG, and ORG must be a firestartr-pre org. The only mode
#            that lets --commit through; the claims-repo before/after diff is
#            the evidence.
#
# Exit: 0 verdict PASS | 1 CLI exit differs from --expect-exit | 2 refused or
# bad usage | 4 guard breach (network attempt, unexpected write, token in evidence).
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

label=drive mode=offline org="" expect=0 seeds=()
while [ $# -gt 0 ]; do
  case "$1" in
    --label) label="$2"; shift 2 ;;
    --mode) mode="$2"; shift 2 ;;
    --org) org="$2"; shift 2 ;;
    --expect-exit) expect="$2"; shift 2 ;;
    --seed) seeds+=("$2"); shift 2 ;;
    --) shift; break ;;
    *) fsf_die "unknown option $1 (fs-forge args go after --)" ;;
  esac
done
[ $# -gt 0 ] || fsf_die "no fs-forge command given after --"
label="$(printf '%s' "$label" | tr -c 'A-Za-z0-9._-' '-')"

# --- refusals: decided before anything runs ---------------------------------
has_commit=0 arg_org=""
prev=""
for arg in "$@"; do
  case "$arg" in
    --commit|--commit=*) has_commit=1 ;;
    --org=*) arg_org="${arg#--org=}" ;;
  esac
  [ "$prev" = "--org" ] && arg_org="$arg"
  prev="$arg"
done

case "$mode" in
  offline)
    [ -z "$org" ] || fsf_die "offline mode takes no --org; use --mode read or write for an org-bound command"
    [ -z "$arg_org" ] || fsf_die "offline mode refuses --org in the command; use --mode read or write"
    [ "$has_commit" = 0 ] || fsf_die "--commit needs --mode write with an explicitly named pre org"
    ;;
  read|write)
    [ -n "$org" ] || fsf_die "$mode mode needs --org <org> named explicitly; there is no default"
    [ -z "$arg_org" ] || [ "$arg_org" = "$org" ] || fsf_die "the command targets --org $arg_org but the drive names $org"
    [ "$mode" = write ] || [ "$has_commit" = 0 ] || fsf_die "--commit needs --mode write"
    command -v gh >/dev/null 2>&1 || fsf_die "gh is required by org-snapshot.sh"
    token="$(fsf_token)" || fsf_die "no GITHUB_TOKEN and 'gh auth token' failed"
    if [ "$mode" = write ]; then
      # Registered pre orgs live in firestartr-pre/app-firestartr (see smoke-test-renderer).
      gh api "repos/firestartr-pre/app-firestartr/contents/kubernetes/firestartr-pre/$org" >/dev/null 2>&1 ||
        fsf_die "write mode refused: $org is not registered under firestartr-pre/app-firestartr kubernetes/firestartr-pre/"
    fi
    ;;
  *) fsf_die "unknown mode $mode (offline, read or write)" ;;
esac

fsf_resolve_node || exit 2
run="$(fsf_run_dir)" || exit 2
seq="$(printf '%02d' "$(( $(ls "$run/evidence" | grep -c '^[0-9][0-9]*-') + 1 ))")"
work="$run/work/$seq-$label"
evid="$run/evidence/$seq-$label"
mkdir -p "$work" "$evid"
: > "$evid/net.log"

for seed in ${seeds[@]+"${seeds[@]}"}; do
  src="${seed%%=*}" dest="${seed#*=}"
  [ "$src" != "$seed" ] || dest="$(basename "$src")"
  [ -e "$src" ] || fsf_die "seed not found: $src"
  mkdir -p "$work/$(dirname "$dest")"
  cp -R "$src" "$work/$dest"
done

# sha256 of every file in the work dir, minus the isolated cache and XDG dirs.
list_files() { (cd "$work" && find . -type f -not -path './.feature-cache/*' -not -path './.xdg/*' -exec shasum -a 256 {} + | sort -k2); }
list_files > "$evid/files-before.txt"

{
  echo "mode=$mode org=${org:-<none>} expect-exit=$expect"
  echo "cwd=$work"
  printf 'cmd=node %s' "$FSF_BIN"; printf ' %q' "$@"; echo
} > "$evid/cmd.txt"

# --- before: claims-repo state for org-bound drives -------------------------
snap="$FSF_SKILL_DIR/scripts/org-snapshot.sh"
if [ "$mode" != offline ]; then
  "$snap" snap "$org" "$evid/org-before.json" || fsf_die "could not snapshot $org/claims before the drive"
fi

# --- run --------------------------------------------------------------------
canary=strict; [ "$mode" = offline ] || canary=log
env_args=(
  -u GITHUB_TOKEN -u GH_TOKEN -u GITHUB_ENTERPRISE_TOKEN -u FSCRT_ORG
  "FS_FORGE_FEATURE_CACHE_DIR=$work/.feature-cache"
  "XDG_CACHE_HOME=$work/.xdg/cache" "XDG_CONFIG_HOME=$work/.xdg/config" "XDG_DATA_HOME=$work/.xdg/data"
  "FSF_CANARY=$canary" "FSF_CANARY_LOG=$evid/net.log"
  "NODE_OPTIONS=${NODE_OPTIONS:-} --require \"$FSF_CANARY_JS\""
)
if [ "$mode" != offline ]; then
  env_args+=("GITHUB_TOKEN=$token" "FSCRT_ORG=$org")
fi
(cd "$work" && env "${env_args[@]}" node "$FSF_BIN" "$@") > "$evid/stdout.txt" 2> "$evid/stderr.txt"
code=$?
echo "$code" > "$evid/exit-code.txt"

# --- after: observe, don't trust --------------------------------------------
verdict=PASS reason="" status=0
if [ "$mode" != offline ]; then
  "$snap" snap "$org" "$evid/org-after.json" || { verdict=FAIL reason="could not snapshot $org/claims after the drive"; status=4; }
  if [ -f "$evid/org-after.json" ]; then
    "$snap" diff "$evid/org-before.json" "$evid/org-after.json" > "$evid/org-diff.txt"
    diff_status=$?
    if [ "$diff_status" != 0 ] && [ "$mode" = read ]; then
      verdict=FAIL reason="read drive changed fs-forge state in $org/claims (see org-diff.txt)"; status=4
    fi
  fi
fi
if [ "$mode" = offline ] && [ -s "$evid/net.log" ]; then
  verdict=FAIL reason="offline drive attempted network connects (see net.log)"; status=4
fi
if [ "$mode" != offline ] && [ -n "${token:-}" ] && grep -rqF -- "$token" "$evid"; then
  verdict=FAIL reason="the GitHub token appears in the evidence"; status=4
fi
if [ "$status" = 0 ] && [ "$code" != "$expect" ]; then
  verdict=FAIL reason="exit code $code, expected $expect"; status=1
fi

list_files > "$evid/files.txt"
diff "$evid/files-before.txt" "$evid/files.txt" > "$evid/files-changed.txt"
echo "$verdict${reason:+ - $reason}" > "$evid/verdict.txt"

echo "--- stdout (first 40 lines) ---"; head -n 40 "$evid/stdout.txt"
echo "--- stderr (first 40 lines) ---"; head -n 40 "$evid/stderr.txt"
[ ! -s "$evid/net.log" ] || { echo "--- net.log ---"; cat "$evid/net.log"; }
echo "DRIVE $seq-$label verdict=$verdict exit=$code evidence=$evid${reason:+ reason=\"$reason\"}"
exit "$status"

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
    --label|--mode|--org|--expect-exit|--seed) [ $# -ge 2 ] || fsf_die "$1 needs a value" ;;
  esac
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
    # Without --commit the CLI takes its dry-run path and the org diff is empty,
    # which would pass as a write proof.
    [ "$mode" = read ] || [ "$has_commit" = 1 ] || fsf_die "--mode write needs --commit in the command; drive a dry run with --mode read"
    command -v gh >/dev/null 2>&1 || fsf_die "gh is required by org-snapshot.sh"
    token="$(fsf_token)" || fsf_die "no GH_TOKEN, GITHUB_TOKEN or 'gh auth token'"
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

work_real="$(cd "$work" && pwd -P)"
for seed in ${seeds[@]+"${seeds[@]}"}; do
  src="${seed%%=*}" dest="${seed#*=}"
  # Absolute, so a source like -delete never reaches find, cp or basename as an option.
  case "$src" in /*) ;; *) src="$PWD/$src" ;; esac
  [ "${seed%%=*}" != "$seed" ] || dest="$(basename -- "$src")"
  [ -e "$src" ] || fsf_die "seed not found: $src"
  # cp -R keeps symlinks, which would let the CLI read outside the work dir and
  # hide the linked files from files-before.txt.
  [ -z "$(find "$src" -type l -print -quit)" ] || fsf_die "seed must not be or contain a symlink: $src"
  case "$dest" in
    /*) fsf_die "seed destination must be relative to the work dir: $dest" ;;
  esac
  case "/$dest/" in
    */../*) fsf_die "seed destination must not contain ..: $dest" ;;
  esac
  [ -L "$work/$dest" ] && fsf_die "seed destination must not be a symlink: $dest"
  # A previous seed can plant a symlink, so resolve the deepest existing
  # ancestor before mkdir: neither mkdir nor cp may leave the canonical work dir.
  parent="$work/$(dirname -- "$dest")"
  probe="$parent"
  while [ ! -d "$probe" ]; do probe="$(dirname "$probe")"; done
  case "$(cd "$probe" && pwd -P)" in
    "$work_real"|"$work_real"/*) ;;
    *) fsf_die "seed destination escapes the work dir: $dest" ;;
  esac
  mkdir -p "$parent"
  real_parent="$(cd "$parent" && pwd -P)" || fsf_die "seed destination is not a directory: $dest"
  case "$real_parent" in
    "$work_real"|"$work_real"/*) ;;
    *) fsf_die "seed destination escapes the work dir: $dest" ;;
  esac
  cp -R "$src" "$work/$dest" || fsf_die "could not copy seed $src to $dest"
done

# sha256 of every file in the work dir, minus the isolated cache and XDG dirs.
list_files() { (cd "$work" && find . -type f -not -path './.feature-cache/*' -not -path './.xdg/*' -exec shasum -a 256 {} + | sort -k2); }
list_files > "$evid/files-before.txt" || fsf_die "could not fingerprint the work dir before the drive"

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
  -u GITHUB_TOKEN -u GH_TOKEN -u GITHUB_ENTERPRISE_TOKEN -u GH_ENTERPRISE_TOKEN -u FSCRT_ORG
  "FS_FORGE_FEATURE_CACHE_DIR=$work/.feature-cache"
  "XDG_CACHE_HOME=$work/.xdg/cache" "XDG_CONFIG_HOME=$work/.xdg/config" "XDG_DATA_HOME=$work/.xdg/data"
  "FSF_CANARY=$canary" "FSF_CANARY_LOG=$evid/net.log"
  "NODE_OPTIONS=--require \"$FSF_CANARY_JS\""
)
if [ "$mode" != offline ]; then
  env_args+=("GITHUB_TOKEN=$token" "FSCRT_ORG=$org")
fi
(cd "$work" && env "${env_args[@]}" node "$FSF_BIN" "$@" < /dev/null) > "$evid/stdout.txt" 2> "$evid/stderr.txt"
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
if [ "$mode" != offline ] && [ -n "${token:-}" ]; then
  token_files="$(grep -rlF -- "$token" "$evid" 2>/dev/null || true)"
  if [ -n "$token_files" ]; then
    # The token must not survive on disk or in the transcript printed below.
    printf '%s\n' "$token_files" | while IFS= read -r f; do
      tmp="$(mktemp "$evid/redact.XXXXXX")" &&
        awk -v s="$token" '{while (i=index($0,s)) $0=substr($0,1,i-1) "[REDACTED]" substr($0,i+length(s))} 1' "$f" > "$tmp" &&
        mv "$tmp" "$f"
    done
    # A failed rewrite leaves the token on disk: stop before the transcript prints it.
    if grep -rqF -- "$token" "$evid" 2>/dev/null; then
      echo "FAIL - the GitHub token appears in the evidence and could not be redacted" > "$evid/verdict.txt"
      echo "ERROR: the GitHub token is in $evid and could not be redacted; delete that dir" >&2
      exit 4
    fi
    verdict=FAIL reason="the GitHub token appears in the evidence (redacted)"; status=4
  fi
fi
if [ "$status" = 0 ] && [ "$code" != "$expect" ]; then
  verdict=FAIL reason="exit code $code, expected $expect"; status=1
fi

# An incomplete fingerprint or a failed diff would read as "no files changed".
if ! list_files > "$evid/files.txt"; then
  verdict=FAIL reason="could not fingerprint the work dir after the drive"; status=4
else
  diff "$evid/files-before.txt" "$evid/files.txt" > "$evid/files-changed.txt"
  [ $? -le 1 ] || { verdict=FAIL reason="could not diff the work dir fingerprints"; status=4; }
fi
echo "$verdict${reason:+ - $reason}" > "$evid/verdict.txt"

echo "--- stdout (first 40 lines) ---"; head -n 40 "$evid/stdout.txt"
echo "--- stderr (first 40 lines) ---"; head -n 40 "$evid/stderr.txt"
[ ! -s "$evid/net.log" ] || { echo "--- net.log ---"; cat "$evid/net.log"; }
echo "DRIVE $seq-$label verdict=$verdict exit=$code evidence=$evid${reason:+ reason=\"$reason\"}"
exit "$status"

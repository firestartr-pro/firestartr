# Sourced by the other scripts; not run directly.
# Resolves the repo, the package, the node toolchain and the run directory.

FSF_SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
FSF_REPO="$(git -C "$FSF_SKILL_DIR" rev-parse --show-toplevel)"
FSF_PKG="$FSF_REPO/packages/fs-forge-cli"
FSF_BIN="$FSF_PKG/bin/run.js"
FSF_CANARY_JS="$FSF_SKILL_DIR/scripts/net-canary.cjs"
# Evidence lives outside the repo, so git never tracks it and cleanup keeps it.
# The base is made absolute: launch.sh symlinks latest into FSF_HOME, and a
# relative base would make that symlink target resolve against its own dir.
fsf_home_base="${FSF_HOME:-${TMPDIR:-/tmp}}"
case "$fsf_home_base" in
  /*) ;;
  *) fsf_home_base="$PWD/$fsf_home_base" ;;
esac
FSF_HOME="${fsf_home_base%/}/verify-fs-forge-cli"

fsf_die() {
  echo "ERROR: $*" >&2
  exit 2
}

# fs-forge needs node >=22. A bare PATH may lack node (nvm loads lazily in
# interactive shells), so fall back to the newest nvm install that qualifies.
# Exported node/npm/npx functions (lazy nvm loaders) are dropped first: bash
# runs a function before PATH, so it would shadow the binary picked here.
fsf_resolve_node() {
  local node major dir
  unset -f node npm npx 2>/dev/null || true
  node="$(command -v node || true)"
  major=0
  [ -n "$node" ] && major="$("$node" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$major" -lt 22 ]; then
    for dir in $(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/v*/bin 2>/dev/null | sort -V -r); do
      major="$("$dir/node" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
      if [ "$major" -ge 22 ]; then
        PATH="$dir:$PATH"
        export PATH
        break
      fi
    done
  fi
  [ "$major" -ge 22 ] || { echo "ERROR: node >=22 not found; install it or put it on PATH" >&2; return 1; }
}

# Prints the run directory: $FSF_RUN, else the one launch.sh opened last.
# The result is canonical and must be a child of $FSF_HOME, so callers that
# rm -rf it (cleanup.sh --purge-evidence) cannot be pointed at an arbitrary
# directory by a typo in FSF_RUN.
fsf_run_dir() {
  local run="${FSF_RUN:-}" home real
  [ -n "$run" ] || run="$(readlink "$FSF_HOME/latest" 2>/dev/null || true)"
  [ -n "$run" ] && [ -d "$run" ] || fsf_die "no run directory; run scripts/launch.sh first (or set FSF_RUN)"
  real="$(cd "$run" && pwd -P)" || fsf_die "could not resolve run directory: $run"
  home="$(cd "$FSF_HOME" 2>/dev/null && pwd -P)" || fsf_die "could not resolve $FSF_HOME; run scripts/launch.sh first"
  case "$real" in
    "$home"/*) ;;
    *) fsf_die "run directory must be under $FSF_HOME: got $real" ;;
  esac
  echo "$real"
}

# Fingerprint of everything git sees changed under packages/.
fsf_packages_state() {
  { git -C "$FSF_REPO" status --porcelain -- packages; git -C "$FSF_REPO" diff -- packages; } |
    shasum | cut -d' ' -f1
}

# The GitHub token for org-bound drives: the caller's, else gh's. Never printed.
fsf_token() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then printf '%s' "$GITHUB_TOKEN"; return; fi
  command -v gh >/dev/null 2>&1 || return 1
  gh auth token 2>/dev/null
}

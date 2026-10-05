# Sourced by the other scripts; not run directly.
# Resolves the repo, the package, the node toolchain and the run directory.

FSF_SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
FSF_REPO="$(git -C "$FSF_SKILL_DIR" rev-parse --show-toplevel)"
FSF_PKG="$FSF_REPO/packages/fs-forge-cli"
FSF_BIN="$FSF_PKG/bin/run.js"
FSF_CANARY_JS="$FSF_SKILL_DIR/scripts/net-canary.cjs"
# Evidence lives outside the repo, so git never tracks it and cleanup keeps it.
FSF_HOME="${FSF_HOME:-${TMPDIR:-/tmp}}"
FSF_HOME="${FSF_HOME%/}/verify-fs-forge-cli"

fsf_die() {
  echo "ERROR: $*" >&2
  exit 2
}

# fs-forge needs node >=22. A bare PATH may lack node (nvm loads lazily in
# interactive shells), so fall back to the newest nvm install that qualifies.
fsf_resolve_node() {
  local node major dir
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
fsf_run_dir() {
  local run="${FSF_RUN:-}"
  [ -n "$run" ] || run="$(readlink "$FSF_HOME/latest" 2>/dev/null || true)"
  [ -n "$run" ] && [ -d "$run" ] || fsf_die "no run directory; run scripts/launch.sh first (or set FSF_RUN)"
  echo "$run"
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

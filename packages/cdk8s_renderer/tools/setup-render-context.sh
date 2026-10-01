#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP_DIR="${REPO_ROOT}/.tmp_dir"
BASE_CLAIMS="${REPO_ROOT}/packages/cdk8s_renderer/__tests__/fixtures/base_claims"
CLAIMS_DEFAULTS="${REPO_ROOT}/packages/cdk8s_renderer/__tests__/fixtures/initializers/claims_defaults.yaml"
INITIALIZERS="${REPO_ROOT}/packages/cdk8s_renderer/__tests__/fixtures/initializers"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--clean]

Setup the render validation context in .tmp_dir/.
Creates directory structure and scaffolds base claims.

Directories:
  .tmp_dir/claims/claims/           Base claims copied from __tests__/fixtures/base_claims/
  .tmp_dir/claims/.config/          Claims defaults config (claims_defaults.yaml)
  .tmp_dir/catalog/                 Catalog entity output
  .tmp_dir/catalog/.config/         Empty config dir
  .tmp_dir/state-github/            GitHub Firestartr CR output
  .tmp_dir/state-github/.config/    GitHub expander config (copied from __tests__/fixtures/initializers/)
  .tmp_dir/state_infra/             Infrastructure (Terraform) CR output
  .tmp_dir/state_infra/.config/     Empty config dir
  .tmp_dir/state-secrets/           Secrets (ExternalSecret) CR output
  .tmp_dir/state-secrets/.config/   Empty config dir

Options:
  --clean   Remove all existing content before scaffolding
  --help    Show this help
EOF
  exit 0
}

CLEAN=false
while [ $# -gt 0 ]; do
  case "$1" in
    --clean) CLEAN=true; shift ;;
    --help|-h) usage ;;
    *) echo "Unknown option: $1" >&2; (usage); exit 1 ;;
  esac
done

if [ "$CLEAN" = true ]; then
  echo "Cleaning .tmp_dir (preserving .token and render.log)..."
  token_file="$(mktemp)"
  log_file="$(mktemp)"
  if [ -f "${TMP_DIR}/.token" ]; then cp "${TMP_DIR}/.token" "${token_file}"; else rm -f "${token_file}"; fi
  if [ -f "${TMP_DIR}/render.log" ]; then cp "${TMP_DIR}/render.log" "${log_file}"; else rm -f "${log_file}"; fi
  rm -rf "${TMP_DIR:?}"
  mkdir -p "${TMP_DIR}"
  if [ -f "${token_file}" ]; then
    mv "${token_file}" "${TMP_DIR}/.token"
    echo "  preserved .token"
  fi
  if [ -f "${log_file}" ]; then
    mv "${log_file}" "${TMP_DIR}/render.log"
    echo "  preserved render.log"
  fi
fi

echo "Creating directory structure..."
mkdir -p "${TMP_DIR}/claims/claims"
mkdir -p "${TMP_DIR}/claims/.config"
mkdir -p "${TMP_DIR}/catalog/.config"
mkdir -p "${TMP_DIR}/state-github/.config"
mkdir -p "${TMP_DIR}/state_infra/.config"
mkdir -p "${TMP_DIR}/state-secrets/.config"

echo "Copying base claims..."
cp -r "${BASE_CLAIMS}/"* "${TMP_DIR}/claims/claims/"

echo "Copying claims defaults..."
cp "${CLAIMS_DEFAULTS}" "${TMP_DIR}/claims/.config/"

echo "Copying initializers to state-github config..."
cp -r "${INITIALIZERS}/"* "${TMP_DIR}/state-github/.config/"

echo "Done. Render context ready at ${TMP_DIR}"
echo ""
echo "  claims/claims/         -> $(find "${TMP_DIR}/claims/claims" -mindepth 1 -maxdepth 1 -type d | wc -l) claim type directories"
echo "  claims/.config/              -> claims_defaults.yaml"
echo "  state-github/               -> empty (output)"
echo "  state-github/.config/       -> $(ls "${TMP_DIR}/state-github/.config/" | wc -l) config files (from initializers/)"
echo "  catalog/                    -> empty (output)"
echo "  catalog/.config/            -> empty"
echo "  state_infra/                -> empty (output)"
echo "  state_infra/.config/        -> empty"
echo "  state-secrets/              -> empty (output)"
echo "  state-secrets/.config/      -> empty"

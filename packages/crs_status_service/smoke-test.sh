#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="${CRS_STATUS_BASE_URL:-http://localhost:9091}"
WAIT_CREATE="${CRS_STATUS_WAIT_CREATE:-20}"
WAIT_DELETE="${CRS_STATUS_WAIT_DELETE:-25}"

cd "${SCRIPT_DIR}"

# JSON report goes to stdout; progress messages go to stderr
npx tsx smoke-test.ts \
  --base-url "${BASE_URL}" \
  --wait-create "${WAIT_CREATE}" \
  --wait-delete "${WAIT_DELETE}"

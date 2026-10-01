#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="firestartr-local-dev"
KUBE_CONTEXT="kind-${CLUSTER_NAME}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
RUN_SH="${REPO_ROOT}/dagger/local-dev/run.sh"
NAMESPACE="default"
DEV_DEPLOY="firestartr-dev"
OPERATOR_WORKDIR="/library/packages/operator"
OPERATOR_LOG="/tmp/operator.log"
PID_FILE="/tmp/run-local-dev.pid"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command> [args]

Commands:
  startup             Ensure cluster + images + dev pod are ready
  down                Tear down the kind cluster
  start               Start the operator in the dev pod
  stop                Stop the operator in the dev pod
  restart             Stop then start the operator
  logs                Tail operator logs from the dev pod
  exec <command>      Run a command in the dev pod
  apply <file|dir>    Apply a CRD file or directory
  provision <crd>     Force re-provisioning by updating annotations
  destroy <crd>       Force-destroy by removing finalizers
  cleanup             Force-destroy all dummies
  tf-cleanup          Force-destroy all TFWorkspace dummy resources
  shell               Open an interactive shell in the dev pod
  smoke-crs-status    Smoke-test the crs-status service using dummy CRs

Run '$(basename "$0") <command> --help' for subcommand help.
EOF
  exit 0
}

ensure_cluster() {
  if ! kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"; then
    echo "Cluster ${CLUSTER_NAME} not found. Run '$(basename "$0") startup' first." >&2
    exit 1
  fi
}

ensure_dev_pod() {
  local ready
  ready=$(kubectl --context "${KUBE_CONTEXT}" get pod -n "${NAMESPACE}" -l app=firestartr,concern=dev -o jsonpath='{.items[0].status.phase}' 2>/dev/null || echo "")
  if [ "$ready" != "Running" ]; then
    echo "Dev pod not ready (status: $ready). Run '$(basename "$0") startup' first." >&2
    exit 1
  fi
}

cmd_startup() {
  if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: $(basename "$0") startup"
    exit 0
  fi
  bash "${RUN_SH}" --silent
}

cmd_down() {
  if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: $(basename "$0") down"
    exit 0
  fi
  bash "${RUN_SH}" --down
}

cmd_start() {
  if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: $(basename "$0") start"
    exit 0
  fi
  ensure_cluster
  ensure_dev_pod
  # fast-json-patch ships a stray index.ts that tsx resolves over index.js,
  # causing a crash on startup. Remove it if present.
  kubectl exec -n "${NAMESPACE}" "deploy/${DEV_DEPLOY}" --context "${KUBE_CONTEXT}" -- \
    sh -c "rm -f /library/node_modules/fast-json-patch/index.ts" 2>/dev/null || true
  local slots_env=""
  if [ -n "${OPERATOR_NUMBER_OF_MAX_SLOTS:-}" ]; then
    slots_env="OPERATOR_NUMBER_OF_MAX_SLOTS=${OPERATOR_NUMBER_OF_MAX_SLOTS}"
    echo "Starting operator with ${OPERATOR_NUMBER_OF_MAX_SLOTS} slots..."
  fi
  kubectl exec -n "${NAMESPACE}" "deploy/${DEV_DEPLOY}" --context "${KUBE_CONTEXT}" -- \
    sh -c "cd ${OPERATOR_WORKDIR} && nohup env TFM_MIRROR_DISABLE=1 TFM_SKIP_GIT_CONFIG=true ${slots_env} npx tsx launch_dev_test.ts </dev/null >${OPERATOR_LOG} 2>&1 &"
  echo "ok"
}

cmd_stop() {
  if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: $(basename "$0") stop"
    exit 0
  fi
  ensure_cluster
  ensure_dev_pod
  kubectl exec -n "${NAMESPACE}" "deploy/${DEV_DEPLOY}" --context "${KUBE_CONTEXT}" -- \
    sh -c "kill \$(cat ${PID_FILE} 2>/dev/null) 2>/dev/null; rm -f ${PID_FILE}" || true
  echo "ok"
}

cmd_restart() {
  if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: $(basename "$0") restart"
    exit 0
  fi
  cmd_stop
  sleep 1
  cmd_start
}

cmd_logs() {
  if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: $(basename "$0") logs"
    exit 0
  fi
  ensure_cluster
  ensure_dev_pod
  kubectl exec -n "${NAMESPACE}" "deploy/${DEV_DEPLOY}" --context "${KUBE_CONTEXT}" -- \
    tail -f "${OPERATOR_LOG}"
}

cmd_exec() {
  if [ "${1:-}" = "--" ]; then
    shift
  fi
  if [ $# -eq 0 ]; then
    echo "Usage: $(basename "$0") exec <command>" >&2
    exit 1
  fi
  if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    cat <<EOF
Usage: $(basename "$0") exec [--] <command>

Run a command inside the dev pod.
Use -- to separate tool flags from the command.

Examples:
  $(basename "$0") exec ls -la /library/packages/operator
  $(basename "$0") exec -- npx tsx launch_dev_test.ts
EOF
    exit 0
  fi
  ensure_cluster
  ensure_dev_pod
  kubectl exec -n "${NAMESPACE}" "deploy/${DEV_DEPLOY}" --context "${KUBE_CONTEXT}" -- "$@"
}

cmd_apply() {
  if [ $# -eq 0 ]; then
    echo "Error: missing file or directory argument." >&2
    echo "Usage: $(basename "$0") apply <file|dir>" >&2
    exit 1
  fi
  if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    cat <<EOF
Usage: $(basename "$0") apply <file|dir>

Apply a CRD file or directory to the cluster.
Paths are relative to the repo root.

Examples:
  $(basename "$0") apply packages/k8s/dev/dummy-crds/fsdummiesa.yaml
  $(basename "$0") apply packages/k8s/dev/dummy-crds/
EOF
    exit 0
  fi
  ensure_cluster
  local target="$1"
  if [[ "$target" != /* ]]; then
    target="${REPO_ROOT}/${target}"
  fi
  if [ ! -e "$target" ]; then
    echo "Error: not found: $1" >&2
    exit 1
  fi
  kubectl --context "${KUBE_CONTEXT}" apply -f "$target"
}

cmd_provision() {
  if [ $# -eq 0 ]; then
    echo "Error: missing CRD name." >&2
    echo "Usage: $(basename "$0") provision <kind/name>" >&2
    exit 1
  fi
  if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    cat <<EOF
Usage: $(basename "$0") provision <kind/name>

Force re-provisioning of a CR by updating the 'firestartr.dev/repro' annotation.
The annotation value is set to the current timestamp.

Example:
  $(basename "$0") provision fsdummiesa/example-dummy
EOF
    exit 0
  fi
  ensure_cluster
  local target="$1"
  local ts
  ts=$(date +%s)
  kubectl --context "${KUBE_CONTEXT}" annotate --overwrite "${target}" "firestartr.dev/repro=${ts}"
  echo "Annotated ${target} with firestartr.dev/repro=${ts}"
}

cmd_destroy() {
  if [ $# -eq 0 ]; then
    echo "Error: missing CRD name." >&2
    echo "Usage: $(basename "$0") destroy <kind/name>" >&2
    exit 1
  fi
  if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    cat <<EOF
Usage: $(basename "$0") destroy <kind/name>

Force-destroy a CR by removing its finalizers. 
This bypasses the operator's deletion logic.

Example:
  $(basename "$0") destroy fsdummiesa/example-dummy
EOF
    exit 0
  fi
  ensure_cluster
  local target="$1"
  kubectl --context "${KUBE_CONTEXT}" patch "${target}" --type json -p '[{"op": "remove", "path": "/metadata/finalizers"}]'
  echo "Removed finalizers from ${target}"
}

cmd_cleanup() {
  local force=false
  if [ "${1:-}" = "--force" ] || [ "${1:-}" = "-f" ]; then
    force=true
  elif [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat <<EOF
Usage: $(basename "$0") cleanup [--force]

Gracefully delete all dummy resources (fsdummiesa, fsdummiesb, fsdummiesc)
and wait for the operator to complete the deletion cycle via finalizers.

If the operator fails to clean up within 60s (e.g. operator is not running),
use --force to bypass finalizers and immediately remove all resources.
EOF
    exit 0
  fi
  ensure_cluster
  local types=("fsdummiesa" "fsdummiesb" "fsdummiesc")

  if [ "$force" = true ]; then
    echo "Force-cleanup: removing finalizers and deleting..."
    for type in "${types[@]}"; do
      local resources
      resources=$(kubectl --context "${KUBE_CONTEXT}" get "${type}" -o name 2>/dev/null || true)
      if [ -z "${resources}" ]; then
        echo "No ${type} found."
        continue
      fi
      for res in ${resources}; do
        kubectl --context "${KUBE_CONTEXT}" patch "${res}" --type json -p '[{"op": "remove", "path": "/metadata/finalizers"}]' 2>/dev/null || true
        kubectl --context "${KUBE_CONTEXT}" delete "${res}" --wait=false 2>/dev/null || true
      done
      echo "Force-cleaned ${type}"
    done
    return
  fi

  # Graceful cleanup: delete all dummies and wait for the operator to finalize.
  echo "Graceful cleanup: deleting all dummy resources..."
  for type in "${types[@]}"; do
    local resources
    resources=$(kubectl --context "${KUBE_CONTEXT}" get "${type}" -o name 2>/dev/null || true)
    if [ -z "${resources}" ]; then
      echo "No ${type} found."
      continue
    fi
    for res in ${resources}; do
      kubectl --context "${KUBE_CONTEXT}" delete "${res}" --wait=false 2>/dev/null || true
    done
    echo "Waiting for ${type} to be fully removed (finalizer cleanup)..."
  done

  # Wait up to 60s for all resources to be cleaned up gracefully.
  local waited=0
  local remaining=""
  while [ "$waited" -lt 60 ]; do
    remaining=""
    for type in "${types[@]}"; do
      local found
      found=$(kubectl --context "${KUBE_CONTEXT}" get "${type}" -o name 2>/dev/null || true)
      if [ -n "$found" ]; then
        remaining="${remaining} ${type}:${found}"
      fi
    done
    if [ -z "$remaining" ]; then
      echo "All resources cleaned up successfully."
      return
    fi
    sleep 3
    waited=$((waited + 3))
  done

  echo "Timed out waiting for graceful cleanup after ${waited}s." >&2
  echo "Remaining: ${remaining}" >&2
  echo "The operator may not be running. Re-run with --force to bypass finalizers." >&2
  exit 1
}

cmd_shell() {
  if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: $(basename "$0") shell"
    exit 0
  fi
  ensure_cluster
  ensure_dev_pod
  exec kubectl exec -n "${NAMESPACE}" "deploy/${DEV_DEPLOY}" --context "${KUBE_CONTEXT}" -it -- /bin/bash
}

cmd_tf_cleanup() {
  local force=false
  if [ "${1:-}" = "--force" ] || [ "${1:-}" = "-f" ]; then
    force=true
  fi
  ensure_cluster

  local types=("terraformworkspaces" "providerconfigs")
  local provider_name="kubernetes-backend"

  echo "Cleaning up TFWorkspace dummy resources..."

  if [ "$force" = true ]; then
    # Force: remove finalizers then delete
    kubectl --context "${KUBE_CONTEXT}" delete "providerconfigs/${provider_name}" --wait=false 2>/dev/null || true
    for type in "${types[@]}"; do
      local resources
      resources=$(kubectl --context "${KUBE_CONTEXT}" get "${type}" -o name 2>/dev/null | grep "^${type}/tf-dummy-\|^providerconfigs/kubernetes-backend" || true)
      if [ -z "${resources}" ]; then continue; fi
      for res in ${resources}; do
        kubectl --context "${KUBE_CONTEXT}" patch "${res}" --type json -p '[{"op": "remove", "path": "/metadata/finalizers"}]' 2>/dev/null || true
        kubectl --context "${KUBE_CONTEXT}" delete "${res}" --wait=false 2>/dev/null || true
      done
    done
    return
  fi

  # Graceful: delete and wait for operator to finalize
  kubectl --context "${KUBE_CONTEXT}" delete "providerconfigs/${provider_name}" --wait=false 2>/dev/null || true
  for type in "${types[@]}"; do
    local resources
    resources=$(kubectl --context "${KUBE_CONTEXT}" get "${type}" -o name 2>/dev/null | grep "^${type}/tf-dummy-\|^providerconfigs/kubernetes-backend" || true)
    if [ -z "${resources}" ]; then continue; fi
    for res in ${resources}; do
      kubectl --context "${KUBE_CONTEXT}" delete "${res}" --wait=false 2>/dev/null || true
    done
  done

  local waited=0
  while [ "$waited" -lt 60 ]; do
    local remaining=""
    for type in "${types[@]}"; do
      local found
      found=$(kubectl --context "${KUBE_CONTEXT}" get "${type}" -o name 2>/dev/null || true)
      if [ -n "$found" ]; then
        remaining="${remaining} ${type}:${found}"
      fi
    done
    if kubectl --context "${KUBE_CONTEXT}" get "providerconfigs/${provider_name}" -o name 2>/dev/null; then
      remaining="${remaining} providerconfigs/${provider_name}"
    fi
    if [ -z "$remaining" ]; then
      echo "TFWorkspace resources cleaned up successfully."
      return
    fi
    sleep 3
    waited=$((waited + 3))
  done

  echo "Timed out waiting for graceful cleanup. Re-run with --force." >&2
  exit 1
}

cmd_smoke_crs_status() {
  if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat <<EOF
Usage: $(basename "$0") smoke-crs-status

Smoke-test the crs-status service using dummy CRs.

Creates 4 dummies (2xA, 1xB→A, 1xC→B), waits for the operator to reconcile,
queries the crs-status service, verifies phase pass-through and tombstones,
then cleans up.

Environment variables:
  CRS_STATUS_SMOKE_WAIT_CREATE   Seconds to wait for creation (default: 20)
  CRS_STATUS_SMOKE_WAIT_DELETE   Seconds to wait for deletion  (default: 25)
EOF
    exit 0
  fi

  ensure_cluster
  ensure_dev_pod

  local wait_create="${CRS_STATUS_SMOKE_WAIT_CREATE:-20}"
  local wait_delete="${CRS_STATUS_SMOKE_WAIT_DELETE:-25}"
  local crs_pid_file="/tmp/crs-status-dev.pid"

  _cleanup_smoke() {
    set +e
    echo ""
    echo "=== Cleanup ==="
    echo "Stopping crs-status service..."
    kubectl exec -n "${NAMESPACE}" "deploy/${DEV_DEPLOY}" --context "${KUBE_CONTEXT}" -- \
      sh -c "kill \$(cat ${crs_pid_file} 2>/dev/null) 2>/dev/null; rm -f ${crs_pid_file}" 2>/dev/null || true
    echo "Destroying dummies..."
    cmd_cleanup --force 2>/dev/null || true
    echo "Cleanup done."
    set -e
  }
  trap _cleanup_smoke EXIT

  # Step 1: Ensure operator is running
  echo "=== Step 1: Starting operator ==="
  cmd_start 2>/dev/null || true
  echo "Operator running."

  # Step 2: Start crs-status service
  echo "=== Step 2: Starting crs-status service ==="
  # Kill any existing crs-status process and wait for port to be freed
  kubectl exec -n "${NAMESPACE}" "deploy/${DEV_DEPLOY}" --context "${KUBE_CONTEXT}" -- \
    sh -c "if [ -f ${crs_pid_file} ]; then kill \$(cat ${crs_pid_file}) 2>/dev/null; rm -f ${crs_pid_file}; fi; for i in \$(seq 5); do curl -sf http://localhost:9091/health >/dev/null 2>&1 || break; sleep 1; done" 2>/dev/null || true
  kubectl exec -n "${NAMESPACE}" "deploy/${DEV_DEPLOY}" --context "${KUBE_CONTEXT}" -- \
    sh -c "cd /library/packages/crs_status_service && nohup npx tsx launch_dev.ts </dev/null >/tmp/crs-status.log 2>&1 &"
  echo "Waiting for crs-status service to be ready..."
  if ! kubectl exec -n "${NAMESPACE}" "deploy/${DEV_DEPLOY}" --context "${KUBE_CONTEXT}" -- \
    sh -c "for i in \$(seq 15); do curl -sf http://localhost:9091/health >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1"; then
    echo "Error: crs-status service did not become healthy within 15s" >&2
    exit 1
  fi
  echo "crs-status service is healthy."

  # Step 3: Generate and apply dummies
  echo "=== Step 3: Creating dummy CRs ==="
  local dir_a dir_b dir_c
  dir_a=$(node "${SCRIPT_DIR}/dummies-ctl.cjs" -t A -n 2 -s 3 -d 2)
  dir_b=$(node "${SCRIPT_DIR}/dummies-ctl.cjs" -t B -n 1 -r fsda-0 -s 3 -d 2)
  dir_c=$(node "${SCRIPT_DIR}/dummies-ctl.cjs" -t C -n 1 -r fsdb-0 -s 3 -d 2)

  echo "Applying dummies..."
  cmd_apply "${dir_a}"
  cmd_apply "${dir_b}"
  cmd_apply "${dir_c}"
  echo "Dummies applied. Waiting ${wait_create}s for operator reconciliation..."
  sleep "${wait_create}"

  # Step 4: Run smoke test
  echo "=== Step 4: Running smoke test ==="
  local report
  report=$(kubectl exec -n "${NAMESPACE}" "deploy/${DEV_DEPLOY}" --context "${KUBE_CONTEXT}" -- \
    bash /library/packages/crs_status_service/smoke-test.sh 2>/dev/null || true)

  echo ""
  echo "=== Smoke Test Results ==="
  echo "$report"

  # Step 5: Determine pass/fail (cleanup runs via trap)
  local passed
  passed=$(echo "$report" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if d['passed'] else 'false')" 2>/dev/null || echo "false")

  echo ""
  if [ "$passed" = "true" ]; then
    echo "=== RESULT: PASS ==="
    exit 0
  else
    echo "=== RESULT: FAIL ==="
    exit 1
  fi
}

if [ $# -eq 0 ]; then
  usage
fi

COMMAND="$1"
shift

case "${COMMAND}" in
  startup)  cmd_startup "$@" ;;
  down)     cmd_down "$@" ;;
  start)    cmd_start "$@" ;;
  stop)     cmd_stop "$@" ;;
  restart)  cmd_restart "$@" ;;
  logs)     cmd_logs "$@" ;;
  exec)     cmd_exec "$@" ;;
  apply)    cmd_apply "$@" ;;
  provision) cmd_provision "$@" ;;
  destroy)   cmd_destroy "$@" ;;
  cleanup)   cmd_cleanup "$@" ;;
  tf-cleanup) cmd_tf_cleanup "$@" ;;
  shell)    cmd_shell "$@" ;;
  smoke-crs-status) cmd_smoke_crs_status "$@" ;;
  help|--help|-h) usage ;;
  *)
    echo "Error: unknown command: ${COMMAND}" >&2
    echo ""
    usage
    ;;
esac

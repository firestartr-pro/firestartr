#!/usr/bin/env bash
#
# Launch an e2e dev pod inside the Kind cluster for interactive debugging.
# The pod uses the operator image, mounts the project at /library, and shares
# the operator's ServiceAccount and secrets.
#
# Usage:
#   CLUSTER_NAME=e2e-local ./dev.sh
#   CLUSTER_NAME=e2e-local IMAGE_TAG=e2e-local ./dev.sh
#
# Prerequisites: a Kind cluster with the operator image loaded and CRDs installed.
# Use wizard.sh to set up the cluster first, then run this script.

set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-}"
IMAGE_TAG="${IMAGE_TAG:-}"
CONFIG_FILE="${CONFIG_FILE:-file://./.test/e2e.yaml}"

if [ -z "$CLUSTER_NAME" ]; then
    echo "❌ CLUSTER_NAME is required. Set it to your Kind cluster name (e.g. e2e-local)."
    exit 1
fi

PORT=-1
if ! PORT=$(docker inspect --format='{{(index (index .NetworkSettings.Ports "6443/tcp") 0).HostPort}}' "${CLUSTER_NAME}-control-plane" 2>/dev/null); then
    echo "❌ Could not find existing kind cluster named ${CLUSTER_NAME}. Please check the name and try again."
    exit 1
fi

echo "▸ Launching e2e dev pod in cluster ${CLUSTER_NAME} (API port: ${PORT})..."

EXTRA_ARGS=()
if [ -n "$IMAGE_TAG" ]; then
    EXTRA_ARGS+=(--image-tag="${IMAGE_TAG}")
fi

dagger \
    --config="${CONFIG_FILE}" \
    call \
    cmd-launch-dev-shell \
      --kubeconfig="${HOME}/.kube" \
      --kind-svc="tcp://localhost:${PORT}" \
      --kind-cluster-name="${CLUSTER_NAME}" \
      "${EXTRA_ARGS[@]}" \
    terminal

#!/bin/bash

set -e

KIND_NAME="kind"
IMAGE_NAME="gitops-k8s-firestartr"
LOCAL_DEV_PATH="${PWD}"
CONTAINER_PATH="/development"

function create_kind_cluster() {

    kind create cluster --name "$KIND_NAME" --config=<(cat <<-EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
  extraMounts:
  - hostPath: ${LOCAL_DEV_PATH}
    containerPath: ${CONTAINER_PATH}
EOF
)
}


function build_image() {
  docker build -f docker/dev.Dockerfile -t "$IMAGE_NAME" .
}

function cluster_exists() {
  kind get clusters 2>/dev/null | grep -qx "$KIND_NAME"
}

function build_and_load_image() {
  #build_image
  if cluster_exists; then
    kind load docker-image "$IMAGE_NAME" --name "$KIND_NAME"
  fi
}

function launch_e2e_operator() {
PORT=45077
CONFIG_FILE="file://./.local/e2e.yaml"
dagger -m dagger/etoe \
    --config=${CONFIG_FILE} \
    call \
    boot-operator \
      --kubeconfig="${HOME}/.kube" \
      --kind-svc="tcp://localhost:${PORT}" 

}

function launch_dev_pod(){
PORT=45077

}

launch_e2e_operator

#create_kind_cluster
#build_and_load_image

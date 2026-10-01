#!/bin/bash

set -e

KIND_NAME="firestartr-local"
CHART_NAME="firestartr"
CHART_VERSION="3.3.0"
IMAGE_NAME="firestartr-controller"
IMAGE_TAG="latest"


LOCAL_DEV_PATH="$(pwd)"
CONTAINER_PATH="/development"

DEFAULT_REPO_STATE_PATH="./"


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
  build_image
  if cluster_exists; then
    kind load docker-image "$IMAGE_NAME" --name "$KIND_NAME"
  fi
}

function force_image_update() {
  if cluster_exists; then
    PODS=$(kubectl get pods -l "app=$IMAGE_NAME" -o name)
    if [ -z "$PODS" ]; then
      echo "No pods found matching label app=$IMAGE_NAME. Nothing to delete."
    else
      kubectl delete pod -l "app=$IMAGE_NAME"
    fi
  fi
}

function helm_install(){
  helm repo add firestartr-controller-kind https://prefapp.github.io/charts/firestartr-controller

  helm repo update

  CHART_PATH="firestartr-controller-kind/firestartr"

  helm upgrade --install  "$CHART_NAME" --version "$CHART_VERSION" "$CHART_PATH" \
        --values helm/local-operator/values.yaml \
        --set general.image="$IMAGE_NAME:$IMAGE_TAG" \
        --set containerPath=${CONTAINER_PATH} \
        --namespace dev \
        --create-namespace
}

function install_crds(){
  curl https://raw.githubusercontent.com/firestartr-pro/docs/refs/heads/main/site/raw/core/crds/latest/index.yaml | kubectl apply -f -
  kubectl apply -f packages/k8s/src/crds
  kubectl apply -f packages/k8s/dev/dummy-crds
}


main () {
  case "${1:-}" in
    create)


      # Check if kind cluster already exists. Exact name match.
      if cluster_exists; then
        echo "Kind cluster already exists"
      else
        echo "Creating kind cluster..."
        create_kind_cluster
        build_and_load_image
        install_crds
        helm_install
      fi
      ;;
    build-image)
      build_and_load_image
      force_image_update
      ;;
    delete-cluster)
      kind delete cluster --name "$KIND_NAME"
      ;;
    helm-release)
      helm_install
      ;;
    install-crds)
      install_crds
      ;;
    delete)
      docker image rm "$IMAGE_NAME"
      kind delete cluster --name "$KIND_NAME"
      ;;
    *)
      echo "Usage:" >&2
      echo "  $0 create" >&2
      echo "  $0 build-image" >&2
      echo "  $0 delete" >&2
      echo "  $0 delete-cluster" >&2
      echo "  $0 helm-release" >&2
      echo "  $0 install-crds" >&2
      exit 1
  esac
}

main "$@"

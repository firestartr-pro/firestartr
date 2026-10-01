#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="firestartr-local-dev"
AUTO=false
COMMAND_WAIT_TIME=5
CHART_VERSION=""
ACTION="up"
SILENT=false
IMAGE_TAG="firestartr-local-dev:latest"

wait_for() {
    local WAIT_TIME=$1
    for ((i=WAIT_TIME; i>0; i--)); do
        printf "\r⏱️  Starting in %d seconds... \e[K" "$i"
        sleep 1
    done
    printf "\r🚀 Starting now!\e[K\n"
}

check_dagger_version() {
    if ! command -v dagger &> /dev/null; then
        echo "❌ Dagger is not installed. Please install Dagger 0.19.7 or greater."
        echo "   Installation instructions: https://docs.dagger.io/install"
        exit 1
    fi

    local INSTALLED_VERSION
    INSTALLED_VERSION=$(dagger version 2>&1 | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | sed 's/v//')
    local MINIMUM_VERSION="0.19.7"

    local INSTALLED_MAJOR; INSTALLED_MAJOR=$(echo "$INSTALLED_VERSION" | cut -d. -f1)
    local INSTALLED_MINOR; INSTALLED_MINOR=$(echo "$INSTALLED_VERSION" | cut -d. -f2)
    local INSTALLED_PATCH; INSTALLED_PATCH=$(echo "$INSTALLED_VERSION" | cut -d. -f3)
    local MINIMUM_MAJOR; MINIMUM_MAJOR=$(echo "$MINIMUM_VERSION" | cut -d. -f1)
    local MINIMUM_MINOR; MINIMUM_MINOR=$(echo "$MINIMUM_VERSION" | cut -d. -f2)
    local MINIMUM_PATCH; MINIMUM_PATCH=$(echo "$MINIMUM_VERSION" | cut -d. -f3)

    local VERSION_OK=false
    if [ "${INSTALLED_MAJOR}" -gt "${MINIMUM_MAJOR}" ]; then
        VERSION_OK=true
    elif [ "${INSTALLED_MAJOR}" -eq "${MINIMUM_MAJOR}" ]; then
        if [ "${INSTALLED_MINOR}" -gt "${MINIMUM_MINOR}" ]; then
            VERSION_OK=true
        elif [ "${INSTALLED_MINOR}" -eq "${MINIMUM_MINOR}" ]; then
            if [ "${INSTALLED_PATCH}" -ge "${MINIMUM_PATCH}" ]; then
                VERSION_OK=true
            fi
        fi
    fi

    if [ "$VERSION_OK" = false ]; then
        echo "❌ Dagger version $INSTALLED_VERSION is installed, but version $MINIMUM_VERSION or greater is required."
        echo "   Please upgrade Dagger: https://docs.dagger.io/install"
        exit 1
    fi

    echo "✅ Dagger version $INSTALLED_VERSION detected (meets minimum requirement of $MINIMUM_VERSION)"
}

check_kind_installed() {
    if ! command -v kind &> /dev/null; then
        echo "❌ kind is not installed. Please install kind: https://kind.sigs.k8s.io/docs/user/quick-start/"
        exit 1
    fi
}

ensure_dagger_develop() {
    local MODULE_DIR="$1"
    echo "🔧 Running dagger develop to ensure SDK bindings are current..."
    (cd "${MODULE_DIR}" && dagger develop --sdk go)
    echo "✅ SDK bindings ready."
}

prompt_continue_skip_abort() {
    local PROMPT_MSG="$1"
    local RESPONSE

    while true; do
        read -r -p "$PROMPT_MSG [y(es)/n(o)/a(bort)]: " RESPONSE
        RESPONSE=${RESPONSE:-y}
        RESPONSE=$(echo "$RESPONSE" | tr '[:upper:]' '[:lower:]')

        case "$RESPONSE" in
            "y" | "ye" | "yes")
                echo "continue"
                return 0
                ;;
            "n" | "no")
                echo "skip"
                return 0
                ;;
            "a" | "ab" | "abo" | "abor" | "abort")
                echo "abort"
                return 0
                ;;
            *)
                echo "❌ Invalid input. Valid values: 'y(es)', 'n(o)', or 'a(bort)'." >&2
                ;;
        esac
    done
}

cluster_exists() {
    kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"
}

cluster_has_extra_mount() {
    docker inspect "${CLUSTER_NAME}-control-plane" --format '{{json .Mounts}}' 2>/dev/null | grep -q '"Destination":"/development"'
}

get_kind_port() {
    docker port "${CLUSTER_NAME}-control-plane" 6443 2>/dev/null | cut -d: -f2
}

image_loaded_in_kind() {
    local TAG="$1"
    while read -r NODE; do
        # Table format splits repo and tag into columns, so "nginx:alpine" never
        # matches; JSON repoTags keep them together. Match the tag only as a full
        # repoTag value (opening '"') or as a registry-prefixed suffix ('/'),
        # closed by '"', so "nginx:alpine" cannot match "mynginx:alpine" or
        # "nginx:alpine-slim".
        if docker exec "${NODE}" crictl images -o json 2>/dev/null | grep -Eq "(\"|/)${TAG//./\\.}\""; then
            return 0
        fi
    done < <(kind get nodes --name "${CLUSTER_NAME}" 2>/dev/null)
    return 1
}

kind_node_platform() {
    local NODE ARCH
    NODE="$(kind get nodes --name "${CLUSTER_NAME}" 2>/dev/null | head -1)"
    ARCH="$(docker exec "${NODE}" uname -m)"
    case "${ARCH}" in
        aarch64|arm64) echo "linux/arm64" ;;
        x86_64|amd64) echo "linux/amd64" ;;
        *) echo "linux/${ARCH}" ;;
    esac
}

load_image_into_kind() {
    local IMAGE="$1"
    if kind load docker-image "${IMAGE}" --name "${CLUSTER_NAME}"; then
        return 0
    fi
    echo "⚠️  kind load docker-image failed for ${IMAGE}; falling back to platform-pinned image-archive..."
    local PLATFORM ARCHIVE LOAD_STATUS=0
    PLATFORM="$(kind_node_platform)"
    ARCHIVE="$(mktemp "${TMPDIR:-/tmp}/kind-image.XXXXXX")"
    # Never leak the temp archive: under set -e a failing save/load would
    # otherwise abort the script before rm -f runs. The failure status is
    # still propagated so callers keep their set -e abort semantics.
    if ! docker save --platform "${PLATFORM}" "${IMAGE}" -o "${ARCHIVE}"; then
        rm -f "${ARCHIVE}"
        return 1
    fi
    kind load image-archive "${ARCHIVE}" --name "${CLUSTER_NAME}" || LOAD_STATUS=$?
    rm -f "${ARCHIVE}"
    return "${LOAD_STATUS}"
}

build_and_load_image() {
    # For the Helm operator pod (idle - tail /dev/null): use nginx:alpine directly
    if image_loaded_in_kind "nginx:alpine"; then
        echo "✅ nginx:alpine already loaded in kind, skipping."
    else
        echo "🔧 Pulling nginx:alpine..."
        docker pull --platform "$(kind_node_platform)" nginx:alpine
        load_image_into_kind "nginx:alpine"
        echo "✅ nginx:alpine loaded into kind."
    fi

    # For the dev pod (Node 22 + tofu + tsx): build from docker/dev.Dockerfile
    if image_loaded_in_kind "${IMAGE_TAG}"; then
        echo "✅ Dev image ${IMAGE_TAG} already loaded in kind, skipping."
    else
        if docker image inspect "${IMAGE_TAG}" &>/dev/null; then
            echo "✅ Dev image ${IMAGE_TAG} already exists locally, skipping build."
        else
            echo "🔧 Building dev image from docker/dev.Dockerfile..."
            docker build -f docker/dev.Dockerfile -t "${IMAGE_TAG}" .
            echo "✅ Dev image built: ${IMAGE_TAG}"
        fi
        load_image_into_kind "${IMAGE_TAG}"
    fi

    echo "✅ Images loaded into kind."
}

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --auto-execute-script)
            AUTO=true
            shift
            ;;
        --wait-time | -w)
            COMMAND_WAIT_TIME="$2"
            shift 2
            ;;
        --chart-version | -c)
            CHART_VERSION="$2"
            shift 2
            ;;
        --down)
            ACTION="down"
            shift
            ;;
        --shell)
            ACTION="shell"
            shift
            ;;
        --silent)
            SILENT=true
            AUTO=true
            shift
            ;;
        --help | -h)
            echo "Usage: $0 [--auto-execute-script] [--chart-version|-c <ver>] [--down] [--shell] [--silent] [--wait-time|-w <s>]"
            echo ""
            echo "Actions:"
            echo "  (default)  Provision the local dev environment and open a shell"
            echo "  --down     Tear down the kind cluster"
            echo "  --shell    Open a shell with kubectl configured for the cluster"
            echo ""
            echo "Options:"
            echo "  --auto-execute-script   Run without interactive prompts"
            echo "  --chart-version|-c      Helm chart version (default: 3.4.1)"
            echo "  --silent                Provision without opening a terminal (exits to shell)"
            echo "  --wait-time|-w          Seconds to wait before auto actions (default: 5)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information."
            exit 1
            ;;
    esac
done

check_dagger_version
check_kind_installed

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODULE_DIR="${SCRIPT_DIR}"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ensure_dagger_develop "${MODULE_DIR}"

if [ "$ACTION" = "down" ]; then
    echo "🗑️  Deleting kind cluster ${CLUSTER_NAME}..."
    kind delete cluster --name "${CLUSTER_NAME}" || true
    echo "✅ Done."
    exit 0
fi

cd "${REPO_ROOT}"

if cluster_exists; then
    if cluster_has_extra_mount; then
        echo "✅ Kind cluster ${CLUSTER_NAME} already exists with extra mounts."
    else
        echo "⚠️  Kind cluster ${CLUSTER_NAME} exists but is missing extra mounts (needed for hostPath volume)."
        if [ "$AUTO" = true ]; then
            echo "🤖 Auto: Deleting and recreating cluster ${CLUSTER_NAME}"
            if [ "$SILENT" = false ]; then
                wait_for "$COMMAND_WAIT_TIME"
            fi
            kind delete cluster --name "${CLUSTER_NAME}"
        else
            PROMPT_RESULT=$(prompt_continue_skip_abort "Delete and recreate kind cluster ${CLUSTER_NAME}?")
            if [ "$PROMPT_RESULT" = "skip" ] || [ "$PROMPT_RESULT" = "abort" ]; then
                echo "🛑 Cluster without extra mounts cannot support hostPath volume. Exiting."
                exit 1
            fi
            kind delete cluster --name "${CLUSTER_NAME}"
        fi
        echo "🔧 Creating kind cluster ${CLUSTER_NAME} with extra mounts..."
        kind create cluster --name "${CLUSTER_NAME}" --config=<(cat <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
  extraMounts:
  - hostPath: ${REPO_ROOT}
    containerPath: /development
EOF
)
        echo "✅ Kind cluster ${CLUSTER_NAME} recreated with extra mounts."
    fi
else
    echo "⚠️  Kind cluster ${CLUSTER_NAME} does not exist."

    if [ "$AUTO" = true ]; then
        echo "🤖 Auto: Creating kind cluster ${CLUSTER_NAME}"
        if [ "$SILENT" = false ]; then
            wait_for "$COMMAND_WAIT_TIME"
        fi
        ACTION_PROMPT="continue"
    else
        ACTION_PROMPT=$(prompt_continue_skip_abort "Create kind cluster ${CLUSTER_NAME}?")
    fi

    case "$ACTION_PROMPT" in
        "continue")
            kind create cluster --name "${CLUSTER_NAME}" --config=<(cat <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
  extraMounts:
  - hostPath: ${REPO_ROOT}
    containerPath: /development
EOF
)
            echo "✅ Kind cluster ${CLUSTER_NAME} created."
            ;;
        "skip")
            echo "🛑 A kind cluster is required. Exiting."
            exit 1
            ;;
        "abort")
            echo "🛑 Aborting."
            exit 1
            ;;
    esac
fi

build_and_load_image

KUBECONFIG_DIR=$(mktemp -d /tmp/kubeconfig-XXXXXXXX)
kind get kubeconfig --name "${CLUSTER_NAME}" > "${KUBECONFIG_DIR}/config"

KIND_PORT=$(get_kind_port)
if [ -z "$KIND_PORT" ]; then
    echo "❌ Failed to get kind API port."
    exit 1
fi
echo "🔌 Kind API port: ${KIND_PORT}"

echo ""
echo "🚀 Running: dagger -m ${MODULE_DIR} --source ${REPO_ROOT} --kubeconfig ${KUBECONFIG_DIR} --kind-svc tcp://localhost:${KIND_PORT}${CHART_VERSION:+ --chart-version $CHART_VERSION} call ${ACTION}${SILENT:+ (silent, no terminal)}"
echo ""

if [ "$SILENT" = true ]; then
    dagger -m "${MODULE_DIR}" \
        --source "${REPO_ROOT}" \
        --kubeconfig "${KUBECONFIG_DIR}" \
        --kind-svc "tcp://localhost:${KIND_PORT}" \
        ${CHART_VERSION:+--chart-version "${CHART_VERSION}"} \
        call "${ACTION}"
else
    dagger -m "${MODULE_DIR}" \
        --source "${REPO_ROOT}" \
        --kubeconfig "${KUBECONFIG_DIR}" \
        --kind-svc "tcp://localhost:${KIND_PORT}" \
        ${CHART_VERSION:+--chart-version "${CHART_VERSION}"} \
        call "${ACTION}" terminal
fi

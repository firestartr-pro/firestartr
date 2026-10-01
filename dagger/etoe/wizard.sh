#!/usr/bin/env bash
#
# Interactive wizard to run the e2e Dagger module (dagger/etoe) with minimal friction.
#
# It asks for every parameter (with sensible defaults), writes non-sensitive
# settings to .local/e2e.yaml, prepares the kind cluster (CRDs + operator image),
# and finally invokes `dagger call cmd-run-tests`.
#
# Usage:
#   ./wizard.sh                                # fully interactive
#   ./wizard.sh --yes                          # accept all defaults
#   ./wizard.sh --suite github --cluster-name my-kind --image-tag e2e-local
#   ./wizard.sh --suite none --dev              # skip tests, launch dev pod
#   ./wizard.sh --suite github --report-dir .tmp/e2e-reports
#
# Stages:
#   1/7  Preflight checks    Verify dagger, docker, kind, kubectl, jq, gh are installed
#   2/7  Test suites         Select which test suites to run (or 'none' to skip)
#   3/7  Kind cluster        Create or reuse a Kind cluster
#   4/7  Operator image      Build, select, or pull the operator image
#   5/7  Config & credentials  Set up org, customer, AWS creds, chart version
#   6/7  Prepare & run e2e   Load image, install CRDs, run tests via Dagger
#   7/7  Dev pod             Optionally launch an in-cluster dev pod for debugging
#
# Flags:
#   --suite <suites>          comma-separated suites (github, terraform, massive,
#                             k8s-rate-limits, crd-upgrade, all, none)
#   --cluster-name <name>     reuse an existing kind cluster (skips cluster creation)
#   --image-tag <tag>         operator image tag to load into kind (skips build prompt)
#   --chart-version <ver>     operator chart version
#   --max-slots <n>           operator concurrent reconciliation slots (default: 4)
#   --yes / -y                non-interactive: accept defaults everywhere
#   --debug-logs              debug-level test logs
#   --report-dir <dir>        write Jest JSON report to <dir>/report.json (relative to repo root)
#   --new-cluster             delete existing cluster and create fresh with project mount
#   --dev                     boot operator (no tests), then launch dev pod
#   --no-dev                  skip the post-test dev pod prompt
#   --boot-only               boot operator only (no tests, no dev pod)
#   --delete-cluster-on-exit  delete the kind cluster when the run ends
#   --help / -h               show this help
#
# Environment variables (all optional, override interactive prompts):
#   CLUSTER_NAME              Kind cluster name
#   IMAGE_TAG                 Operator image tag
#   AWS_ACCESS_KEY_ID         AWS access key (also read from .env)
#   AWS_SECRET_ACCESS_KEY     AWS secret key (also read from .env)
#   AWS_SESSION_TOKEN         AWS session token (also read from .env)
#
# Examples:
#   ./wizard.sh                                        # full interactive flow
#   ./wizard.sh -y                                     # accept all defaults
#   ./wizard.sh --suite github --debug-logs            # run github suite with debug
#   ./wizard.sh --suite none --dev                     # dev pod only, no tests
#   ./wizard.sh --new-cluster --boot-only              # boot operator only, no tests/pod
#   ./wizard.sh --suite k8s-rate-limits --report-dir .tmp/rate-limits
#   ./wizard.sh --new-cluster --suite github       # fresh cluster with project mount
#   ./wizard.sh --cluster-name my-cluster --no-dev  # reuse cluster, skip dev pod
#   ./wizard.sh --delete-cluster-on-exit               # auto-cleanup after run
#
# Cluster lifecycle:
#   - If --cluster-name matches an existing Kind cluster, it is reused.
#   - Otherwise a new cluster is created (takes ~1 min).
#   - On exit, unless --delete-cluster-on-exit is set, the cluster is kept
#     for reuse. Reuse it next time with: --cluster-name <name>
#
# Dev pod:
#   Stage 7 launches a persistent pod (name: e2e-dev) inside the Kind cluster.
#   The pod uses the operator image, mounts the project at /library, and shares
#   the operator's ServiceAccount and secrets.
#   Enter with: kubectl exec -it e2e-dev -n default -- sh
#   Delete with: kubectl delete pod e2e-dev -n default

set +x  # Keep credential-bearing shell assignments out of traces.
set -euo pipefail

# Resolve symlinks so the wizard works from any path, incl. symlinks in ~/bin
SELF="${BASH_SOURCE[0]}"
while [ -L "$SELF" ]; do
    DIR="$(cd "$(dirname "$SELF")" && pwd)"
    SELF="$(readlink "$SELF")"
    case "$SELF" in /*) ;; *) SELF="${DIR}/${SELF}" ;; esac
done
SCRIPT_DIR="$(cd "$(dirname "$SELF")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/.local/e2e.yaml"
BASELINE_CONFIG="${REPO_ROOT}/.github/e2e.yaml"
OPERATOR_IMAGE_REPO="ghcr.io/firestartr-pro/firestartr"

# ---------------------------------------------------------------- state

SUITES="${SUITES:-}"
CLUSTER_NAME="${CLUSTER_NAME:-}"
REUSE_CLUSTER=false
IMAGE_TAG="${IMAGE_TAG:-}"
CHART_VERSION="${CHART_VERSION:-}"
MAX_SLOTS="${MAX_SLOTS:-}"
BUILD_IMAGE=false
USE_CONFIG_IMAGE=""
AUTO=false
DEBUG_LOGS=false
DELETE_CLUSTER_ON_EXIT=false
CREATED_CLUSTER=false
DAGGER_ENV_SHADOW_CREATED=false
PREFLIGHT_DONE=false
DEV_POD=""
BOOT_ONLY=false
REPORT_DIR=""
NEW_CLUSTER=false

# ---------------------------------------------------------------- helpers

GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YELLOW=$'\033[1;33m'; CYAN=$'\033[0;36m'; BOLD=$'\033[1m'; NC=$'\033[0m'

# No colors when not attached to a terminal
if [ ! -t 1 ]; then
    GREEN=''; RED=''; YELLOW=''; CYAN=''; BOLD=''; NC=''
fi

say()  { printf "${CYAN}▸${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}✅ %s${NC}\n" "$*"; }
err()  { printf "${RED}❌ %s${NC}\n" "$*" >&2; }
warn() { printf "${YELLOW}⚠️  %s${NC}\n" "$*"; }
stage(){ printf "\n${BOLD}== %s ==${NC}\n" "$*"; }

# ask <prompt> <default>  → echoes the answer (default when empty / AUTO)
ask() {
    local prompt="$1" default="$2" answer
    if [ "$AUTO" = true ]; then
        printf "${CYAN}▸${NC} %s ${YELLOW}[auto: %s]${NC}\n" "$prompt" "$default"
        echo "$default"
        return
    fi
    read -r -p "$(printf '%s' "${prompt} ")${YELLOW}[${default}]${NC}: " answer
    echo "${answer:-$default}"
}

# ask_secret <prompt> <default>  → masked entry for secrets (shows ****)
ask_secret() {
    local prompt="$1" default="$2" answer char count
    if [ "$AUTO" = true ]; then
        printf "${CYAN}▸${NC} %s ${YELLOW}[auto: %s]${NC}\n" "$prompt" "${default:+<saved>}" >&2
        echo "$default"
        return
    fi
    if [ -n "$default" ]; then
        printf '%s' "${prompt} [${YELLOW}Enter = keep saved${NC}]: " >&2
    else
        printf '%s' "${prompt}: " >&2
    fi
    answer=""
    count=0
    while IFS= read -r -s -n 1 char; do
        case "$char" in
            "") break ;;           # Enter → done
            $'\x7f'|$'\x08')       # Backspace
                if [ "$count" -gt 0 ]; then
                    answer="${answer%?}"
                    count=$((count - 1))
                    printf '\b \b' >&2
                fi
                ;;
            *)                     # Any other character
                answer="${answer}${char}"
                count=$((count + 1))
                printf '*' >&2
                ;;
        esac
    done
    printf '\n' >&2
    echo "${answer:-$default}"
}

# ask_yes <prompt> <default(y|n)>
ask_yes() {
    local prompt="$1" default="${2:-y}" answer
    if [ "$AUTO" = true ]; then
        printf "${CYAN}▸${NC} %s ${YELLOW}[auto: %s]${NC}\n" "$prompt" "$default"
        echo "$default"
        return
    fi
    read -r -p "$(printf '%s' "${prompt} ")${YELLOW}[${default}]${NC}: " answer
    answer=$(echo "${answer:-$default}" | tr '[:upper:]' '[:lower:]')
    case "$answer" in y|yes) echo y ;; *) echo n ;; esac
}

# read a quoted scalar out of a yaml file; fails if missing: get_yaml file key
get_yaml() {
    local value
    value="$(sed -n "s/^[[:space:]]*$2:[[:space:]]*[\"']\(.*\)[\"'][[:space:]]*$/\1/p" "$1" 2>/dev/null | head -1)"
    [ -n "$value" ] && printf '%s' "$value" || return 1
}

# read a value from the repository .env without sourcing arbitrary shell code
get_dotenv() {
    local key="$1" value line
    [ -f "${REPO_ROOT}/.env" ] || return 1
    line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "${REPO_ROOT}/.env" | tail -1)" || return 1
    value="${line#*=}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    case "$value" in
        \"*\") value="${value:1:${#value}-2}" ;;
        \'*\') value="${value:1:${#value}-2}" ;;
    esac
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    [ -n "$value" ] && printf '%s' "$value" || return 1
}

cleanup() {
    local exit_code=$? answer
    if [ "$DAGGER_ENV_SHADOW_CREATED" = true ]; then
        rm -f "${SCRIPT_DIR}/.env"
    fi
    if [ "$exit_code" -ne 0 ] && [ "$PREFLIGHT_DONE" = true ]; then
        err "The e2e run failed (exit code ${exit_code})."
    fi
    if [ "$DELETE_CLUSTER_ON_EXIT" = true ]; then
        say "Deleting kind cluster ${CLUSTER_NAME} (--delete-cluster-on-exit)"
        kind delete cluster --name "${CLUSTER_NAME}" || true
    elif [ "$CREATED_CLUSTER" = true ] && [ "$AUTO" != true ]; then
        printf '%s' "🧹 Delete kind cluster '${CLUSTER_NAME}' so the next run creates a fresh one instead? "
        read -r -p "[y/N]: " answer
        case "$(echo "$answer" | tr '[:upper:]' '[:lower:]')" in
            y|yes) kind delete cluster --name "${CLUSTER_NAME}" || true ;;
            *) say "Cluster kept. Reuse it next time with: $0 --cluster-name ${CLUSTER_NAME}" ;;
        esac
    fi
    exit "$exit_code"
}
trap cleanup EXIT

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    sed -n '3,66p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
fi

# ---------------------------------------------------------------- preflight

stage "1/7 Preflight checks"

check_bin() {
    if command -v "$1" &>/dev/null; then
        ok "$1 found: $(command -v "$1")"
    else
        err "$1 is not installed. $2"
        exit 1
    fi
}

check_bin dagger "Install it from https://docs.dagger.io/install (the version should match the one pinned in dagger/etoe/dagger.json)."
check_bin docker "Install it from https://docs.docker.com/engine/install/"
check_bin kind   "Install it from https://kind.sigs.k8s.io/docs/user/quick-start/#installation"
check_bin kubectl "Install it from https://kubernetes.io/docs/tasks/tools/"
check_bin jq     "Install it from https://jqlang.github.io/jq/download/ (e.g. 'sudo apt-get install jq' or 'brew install jq')."
check_bin gh     "Install it from https://cli.github.com/ (needed to suggest the latest operator chart version)."

if ! docker info &>/dev/null; then
    err "Docker daemon is not running. Start it and retry."
    exit 1
fi
ok "Docker daemon is running"

# Info only: versions of the tools we will drive
pinned_dagger="$(jq -r '.engineVersion // empty' "${SCRIPT_DIR}/dagger.json" 2>/dev/null || true)"
installed_dagger="$(dagger version 2>&1 | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
say "Dagger: ${installed_dagger:-unknown} (module pins ${pinned_dagger:-?} in dagger.json)"
say "kind: $(kind version 2>/dev/null || echo unknown) | kubectl: $(kubectl version --client 2>/dev/null | head -1 || echo unknown)"

# ---------------------------------------------------------------- args

while [[ $# -gt 0 ]]; do
    case "$1" in
        --suite|-s)          SUITES="$2"; shift 2 ;;
        --cluster-name|-k)   CLUSTER_NAME="$2"; REUSE_CLUSTER=true; shift 2 ;;
        --image-tag|-i)      IMAGE_TAG="$2"; shift 2 ;;
        --chart-version|-c)  CHART_VERSION="$2"; shift 2 ;;
        --max-slots)         MAX_SLOTS="$2"; shift 2 ;;
        --yes|-y)            AUTO=true; shift ;;
        --debug-logs)        DEBUG_LOGS=true; shift ;;
        --delete-cluster-on-exit|-d) DELETE_CLUSTER_ON_EXIT=true; shift ;;
        --dev)                      DEV_POD=y; shift ;;
        --no-dev)                   DEV_POD=n; shift ;;
        --report-dir)               REPORT_DIR="$2"; shift 2 ;;
        --new-cluster)              NEW_CLUSTER=true; shift ;;
        --boot-only)                BOOT_ONLY=true; DEV_POD=n; shift ;;
        --help|-h)
            sed -n '3,66p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *) err "Unknown option: $1 (see --help)"; exit 1 ;;
    esac
done

# ---------------------------------------------------------------- suites
PREFLIGHT_DONE=true

stage "2/7 Test suites"

if [ -z "$SUITES" ]; then
    SUITES=$(ask "Which suites? (github, terraform, massive, k8s-rate-limits, crd-upgrade, all, none or comma list)" "github")
fi
say "Suites: ${SUITES}"

# ---------------------------------------------------------------- cluster

stage "3/7 Kind cluster"

needs_rate_limits=false
case ",$(echo "${SUITES}" | tr '[:upper:]' '[:lower:]')," in
    *,k8s-rate-limits,*) needs_rate_limits=true ;;
    *,all,*)             needs_rate_limits=true ;;
esac

if [ "$needs_rate_limits" = true ] && [ "$NEW_CLUSTER" != true ] && [ "$REUSE_CLUSTER" != true ]; then
    warn "The k8s-rate-limits suite needs API rate limits (max-requests-inflight=10)."
    warn "These break kubeadm bootstrap, so they are NOT applied by default."
    warn "Use --new-cluster to create a cluster with rate limits, or pre-create one."
fi

# Generate Kind config with project volume mount (required for dev pod and operator)
KIND_CONFIG_FILE=$(mktemp /tmp/e2e-kind-config-XXXXXX.yaml)
cat > "${KIND_CONFIG_FILE}" <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
  extraMounts:
  - hostPath: ${REPO_ROOT}
    containerPath: /development
EOF

if [ "$NEW_CLUSTER" = true ]; then
    # Stop all existing Kind clusters first to free memory.
    # Kind clusters each consume significant RAM; running multiple simultaneously
    # causes kube-apiserver to fail during kubeadm init (OOM / connection refused).
    existing_clusters="$(kind get clusters 2>/dev/null || true)"
    if [ -n "$existing_clusters" ]; then
        say "Stopping existing Kind clusters to free memory..."
        for c in $existing_clusters; do
            say "  Deleting cluster '${c}'..."
            kind delete cluster --name "$c" 2>/dev/null || true
        done
        ok "All existing Kind clusters stopped"
    fi

    CLUSTER_NAME="${CLUSTER_NAME:-e2e-local}"
    say "Creating kind cluster '${CLUSTER_NAME}' with project mount (takes ~1 min)..."
    kind create cluster --name "${CLUSTER_NAME}" --config="${KIND_CONFIG_FILE}"
    CREATED_CLUSTER=true
    ok "Kind cluster '${CLUSTER_NAME}' created"

    # Apply API server rate limits AFTER kubeadm bootstrap completes.
    # Rate limits in kubeadmConfigPatches break kubeadm init because kubeadm
    # itself needs to make API calls (ClusterRoleBinding, etc.) during bootstrap.
    if [ "$needs_rate_limits" = true ]; then
        say "Applying API server rate limits (max-requests-inflight=10)..."
        CONTROL_PLANE="${CLUSTER_NAME}-control-plane"
        # Patch the kube-apiserver static pod manifest to add rate limit flags
        docker exec "$CONTROL_PLANE" sh -c '
            sed -i "/^    - --tls-private-key-file/a\\    - --max-requests-inflight=10\\n    - --max-mutating-requests-inflight=5" /etc/kubernetes/manifests/kube-apiserver.yaml
        '
        say "Waiting for API server to restart with rate limits..."
        # Wait for API server to become fully ready (not just /readyz, but able
        # to serve API requests). The kube-apiserver restart can take time to
        # stabilize, and premature API calls cause EOF errors.
        for i in $(seq 1 90); do
            if kubectl get --raw /readyz &>/dev/null && \
               kubectl get namespaces -o name &>/dev/null; then
                ok "API server restarted with rate limits"
                break
            fi
            if [ "$i" -eq 90 ]; then
                err "API server did not restart within 90s after applying rate limits"
                exit 1
            fi
            sleep 1
        done
        # Extra settling time: static pod restarts can cause brief flapping
        sleep 5
    fi
elif [ "$REUSE_CLUSTER" = true ]; then
    say "Reusing existing kind cluster: ${CLUSTER_NAME}"
else
    existing_clusters="$(kind get clusters 2>/dev/null || true)"
    if [ -n "$existing_clusters" ] && [ "$AUTO" != true ]; then
        say "Existing kind clusters:"
        echo "$existing_clusters" | sed 's/^/    /'
        default_name="${CLUSTER_NAME:-e2e-local}"
        answer=$(ask "Cluster name (empty = create a new one named '${default_name}')" "")
        if [ -n "$answer" ]; then
            CLUSTER_NAME="$answer"
            REUSE_CLUSTER=true
        fi
    fi
    if [ "$REUSE_CLUSTER" != true ]; then
        CLUSTER_NAME="${CLUSTER_NAME:-e2e-local}"
        if kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"; then
            say "Cluster '${CLUSTER_NAME}' already exists — reusing it"
            REUSE_CLUSTER=true
        fi
    fi
    if [ "$REUSE_CLUSTER" != true ]; then
        say "Creating kind cluster '${CLUSTER_NAME}' with project mount (takes ~1 min)..."
        kind create cluster --name "${CLUSTER_NAME}" --config="${KIND_CONFIG_FILE}"
        CREATED_CLUSTER=true
        ok "Kind cluster '${CLUSTER_NAME}' created"
    fi
fi

rm -f "${KIND_CONFIG_FILE}"

KIND_PORT="$(docker inspect --format='{{(index (index .NetworkSettings.Ports "6443/tcp") 0).HostPort}}' "${CLUSTER_NAME}-control-plane" \
    || { err "Could not find kind cluster '${CLUSTER_NAME}'. Check the name or create a new one (pass no --cluster-name)."; exit 1; })"
ok "Cluster '${CLUSTER_NAME}' API port: ${KIND_PORT}"

kubectl config use-context "kind-${CLUSTER_NAME}" &>/dev/null

# ---------------------------------------------------------------- image

stage "4/7 Operator image"

if [ "$AUTO" = true ]; then
    choice="1"
elif [ -n "$IMAGE_TAG" ]; then
    choice="2"
else
    choice=$(ask "Operator image: [1] build locally (default)  [2] existing local/pulled tag  [3] published image, no preloading (--use-config-image)" "1")
fi

case "$choice" in
    1)
        IMAGE_TAG="${IMAGE_TAG:-e2e-local}"
        BUILD_IMAGE=true
        ;;
    2)
        IMAGE_TAG=$(ask "Operator image tag to load into kind" "${IMAGE_TAG:-e2e-local}")
        ;;
    3)
        USE_CONFIG_IMAGE=true
        latest_v="$(jq -r '."." // empty' "${REPO_ROOT}/.release-please-manifest.json" 2>/dev/null || true)"
        [ -n "$latest_v" ] && latest_v="v${latest_v}_full-aws"
        IMAGE_TAG=$(ask "Published operator image tag" "${latest_v:-latest_full-aws}")
        ;;
esac
OPERATOR_IMAGE="${OPERATOR_IMAGE_REPO}:${IMAGE_TAG}"
OPERATOR_IMAGE_NAME="${OPERATOR_IMAGE%:*}"
say "Operator image: ${OPERATOR_IMAGE}${USE_CONFIG_IMAGE:+ (pullable by the cluster, --use-config-image)}"

# CRD upgrade baseline image (required by the crd-upgrade suite)
BASELINE_ARGS=()
lower_suites="$(echo "$SUITES" | tr '[:upper:]' '[:lower:]')"
if [[ ",${lower_suites}," == *",crd-upgrade,"* || ",${lower_suites}," == *",all,"* ]]; then
    baseline_version=$(ask "CRD upgrade baseline version" "latest")
    if [ "$baseline_version" = "latest" ] || [ -z "$baseline_version" ]; then
        baseline_version="$(jq -r '."." // empty' "${REPO_ROOT}/.release-please-manifest.json" 2>/dev/null || true)"
        [ -z "$baseline_version" ] && { err "Cannot resolve 'latest' baseline: .release-please-manifest.json has no '.' entry."; exit 1; }
    fi
    case "$baseline_version" in v*) ;; *) baseline_version="v${baseline_version}" ;; esac
    baseline_tag="${baseline_version}_full-aws"
    BASELINE_ARGS=(--crd-upgrade-baseline-version="${baseline_version}" --crd-upgrade-baseline-operator-image-tag="${baseline_tag}")
    say "CRD upgrade baseline image: ${OPERATOR_IMAGE_REPO}:${baseline_tag}"
    say "Pulling baseline image (a GHCR login may be required: docker login ghcr.io)..."
    if ! docker pull --platform linux/amd64 "${OPERATOR_IMAGE_REPO}:${baseline_tag}"; then
        err "Could not pull ${OPERATOR_IMAGE_REPO}:${baseline_tag}. Run 'docker login ghcr.io' and retry."
        exit 1
    fi
    kind load docker-image "${OPERATOR_IMAGE_REPO}:${baseline_tag}" --name "${CLUSTER_NAME}"
    ok "Baseline image loaded into kind"
fi

# ---------------------------------------------------------------- config + credentials

stage "5/7 Config & AWS credentials"

# Latest chart version from prefapp/charts releases (e.g. tag firestartr-v4.0.0 -> 4.0.0)
LATEST_CHART="$(gh release list --repo prefapp/charts --limit 100 --json tagName \
    --jq '.[] | select(.tagName | contains("firestartr")) | .tagName' 2>/dev/null \
    | head -1 | sed 's/^firestartr-v//' || true)"
if [ -n "${LATEST_CHART}" ]; then
    # Informational only — do not make this the prompt default. Users should get
    # the value from (1) explicit env/flag, (2) an explicit user config file, or
    # (3) the pinned fallback below. Using LATEST_CHART here would defeat the
    # purpose of pinning the local default to 4.1.0.
    ok "Latest operator chart: ${LATEST_CHART}"
else
    warn "Could not fetch the latest chart version from prefapp/charts (gh auth ok?). Falling back to the pinned default or user config."
fi
# DEFAULT_CHART: only read from an explicit user config file. We intentionally
# ignore the repository baseline config (.github/e2e.yaml) here because that
# file may contain an older chartVersion used for CI baseline testing. The
# wizard's prompt default should prefer a user-provided config; otherwise it
# falls back to the pinned value (4.1.0) so local runs default consistently.
DEFAULT_CHART="$(get_yaml "${CONFIG_FILE}" chartVersion || true)"
# Use env/flag if set, otherwise prompt with config or fallback to 4.1.0
CHART_VERSION="${CHART_VERSION:-$(ask "Operator chart version" "${DEFAULT_CHART:-4.1.0}")}"
MAX_SLOTS="${MAX_SLOTS:-$(ask "Operator max concurrent slots (OPERATOR_NUMBER_OF_MAX_SLOTS)" "4")}"
ORG=$(ask "Org" "$(get_yaml "${CONFIG_FILE}" org || get_yaml "${BASELINE_CONFIG}" org || echo firestartr-e2e)")
CUSTOMER=$(ask "Customer" "$(get_yaml "${CONFIG_FILE}" customer || get_yaml "${BASELINE_CONFIG}" customer || echo firestartr-e2e)")
REGION=$(ask "AWS region" "$(get_yaml "${CONFIG_FILE}" region || get_yaml "${BASELINE_CONFIG}" region || echo eu-west-1)")

DOTENV_ACCESS_KEY="$(get_dotenv AWS_ACCESS_KEY_ID || true)"
DOTENV_SECRET_KEY="$(get_dotenv AWS_SECRET_ACCESS_KEY || true)"
DOTENV_TOKEN="$(get_dotenv AWS_SESSION_TOKEN || true)"

if [ -n "$DOTENV_ACCESS_KEY" ] && [ -n "$DOTENV_SECRET_KEY" ]; then
    keep=$(ask_yes "AWS credentials found in ${REPO_ROOT}/.env. Reuse them?" "y")
    if [ "$keep" = "y" ]; then
        keep="dotenv"
    fi
elif [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; then
    keep=$(ask_yes "AWS credentials found in the environment. Reuse them?" "y")
else
    keep="n"
fi

if [ "$keep" = "dotenv" ]; then
    ACCESS_KEY="$DOTENV_ACCESS_KEY"
    SECRET_KEY="$DOTENV_SECRET_KEY"
    TOKEN="$DOTENV_TOKEN"
elif [ "$keep" = "y" ]; then
    ACCESS_KEY="$AWS_ACCESS_KEY_ID"
    SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
    TOKEN="${AWS_SESSION_TOKEN:-}"
else
    ACCESS_KEY=$(ask_secret "AWS access key" "")
    SECRET_KEY=$(ask_secret "AWS secret key" "")
    TOKEN=$(ask_secret "AWS session token (optional, for temporary credentials)" "")
fi

if [ -z "$ACCESS_KEY" ] || [ -z "$SECRET_KEY" ]; then
    err "AWS access key and secret key are required for local runs."
    exit 1
fi

mkdir -p "${SCRIPT_DIR}/.local"
cat > "${CONFIG_FILE}" <<EOF
---
org: "${ORG}"
customer: "${CUSTOMER}"
cluster: "kind"
operator:
  chartVersion: "${CHART_VERSION}"
  imageName: "${OPERATOR_IMAGE_NAME}"
  imageTag: "${IMAGE_TAG}"
  maxSlots: "${MAX_SLOTS}"
credentials:
  region: "${REGION}"
EOF
chmod 600 "${CONFIG_FILE}"
ok "Config written to ${CONFIG_FILE} (no credentials stored)"

export AWS_ACCESS_KEY_ID="${ACCESS_KEY}"
export AWS_SECRET_ACCESS_KEY="${SECRET_KEY}"
export AWS_SESSION_TOKEN="${TOKEN}"
DAGGER_SECRET_ARGS=(
    --aws-access-key=env:AWS_ACCESS_KEY_ID
    --aws-secret-access-key=env:AWS_SECRET_ACCESS_KEY
    --aws-session-token=env:AWS_SESSION_TOKEN
)
unset ACCESS_KEY SECRET_KEY TOKEN DOTENV_ACCESS_KEY DOTENV_SECRET_KEY DOTENV_TOKEN

if [ "${DEBUG_LOGS}" != true ] && [ "$AUTO" != true ]; then
    [ "$(ask_yes "Enable debug-level test logs?" "n")" = "y" ] && DEBUG_LOGS=true || DEBUG_LOGS=false
fi

# ---------------------------------------------------------------- prepare & run

stage "6/7 Prepare cluster & run e2e"

if [ "$BUILD_IMAGE" = true ]; then
    say "Building operator image ${OPERATOR_IMAGE} (this can take a while)..."
    docker build --file "${REPO_ROOT}/docker/full-aws.Dockerfile" --tag "${OPERATOR_IMAGE}" "${REPO_ROOT}"
    ok "Operator image built"
fi

if [ "$USE_CONFIG_IMAGE" != true ]; then
    if ! docker image inspect "${OPERATOR_IMAGE}" &>/dev/null; then
        say "Image not local, pulling ${OPERATOR_IMAGE}..."
        docker pull --platform linux/amd64 "${OPERATOR_IMAGE}" \
            || { err "Could not get ${OPERATOR_IMAGE} locally. Build it (option 1) or log in to GHCR."; exit 1; }
    fi
    kind load docker-image "${OPERATOR_IMAGE}" --name "${CLUSTER_NAME}"
    ok "Operator image loaded into kind"
fi

say "Installing Firestartr CRDs into the cluster..."
# Brief pause to let API server fully stabilize after image loading
sleep 2
kubectl apply --validate=false -f "${REPO_ROOT}/packages/k8s/src/crds/"
ok "CRDs installed"

NAME_PREFIX="local-$(date +%s)"

LOG_DIR="${REPO_ROOT}/.tmp_dir"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/e2e-wizard-$(date +%Y%m%d-%H%M%S).log"

# Dagger v0.19.10 parses the nearest .env and otherwise walks up to the
# repository .env, which may use shell-only `export KEY=value` syntax.
if [ ! -e "${SCRIPT_DIR}/.env" ]; then
    : > "${SCRIPT_DIR}/.env"
    DAGGER_ENV_SHADOW_CREATED=true
fi

TESTS_RAN=false
lower_suites_check="$(echo "${SUITES}" | tr '[:upper:]' '[:lower:]')"
if [ "$DEV_POD" = "y" ] || [ "$BOOT_ONLY" = true ] || [ "$lower_suites_check" = "none" ]; then
    # Boot the operator without running tests, then optionally launch dev pod.
    # This ensures the full operator release is deployed (chart, deployment,
    # ServiceAccount, etc.) before the developer enters the pod.
    say "Booting operator (no tests)..."
    (
        cd "${SCRIPT_DIR}"
        dagger --config="file://${CONFIG_FILE}" "${DAGGER_SECRET_ARGS[@]}" \
        call cmd-boot-operator \
        --kubeconfig="${HOME}/.kube" \
        --kind-svc="tcp://localhost:${KIND_PORT}" \
        --kind-cluster-name="${CLUSTER_NAME}" \
        --image-tag="${IMAGE_TAG}" \
        --chart-version="${CHART_VERSION}" \
        ${USE_CONFIG_IMAGE:+--use-config-image} \
        2>&1 | tee "${LOG_FILE}"
    ) || { err "Failed to boot operator"; exit 1; }
    ok "Operator booted successfully"
else
    source "${SCRIPT_DIR}/load-e2e-auth.sh"
    fetch_e2e_test_credentials "$CUSTOMER" "$ORG" "$REGION" || exit 1
    DAGGER_TEST_SECRET_ARGS=(
        --github-app-id=env:GITHUB_APP_ID
        --github-app-pem-file=env:GITHUB_APP_PEM_FILE
        --prefapp-bot-pat=env:PREFAPP_BOT_PAT
    )
    say "Running dagger e2e (suites: ${SUITES})..."
    say "Logging to ${LOG_FILE}"
    echo

    # The dagger module must be invoked from its own directory (dagger/etoe),
    # otherwise dagger loads the module from the caller's CWD and fails with "module not found".
    dagger_exit=0
    CONTAINER_REPORT_DIR=""
    if [ -n "$REPORT_DIR" ]; then
        CONTAINER_REPORT_DIR="/library/${REPORT_DIR}"
        mkdir -p "${REPO_ROOT}/${REPORT_DIR}"
    fi
    (
        cd "${SCRIPT_DIR}"
        dagger --config="file://${CONFIG_FILE}" "${DAGGER_SECRET_ARGS[@]}" "${DAGGER_TEST_SECRET_ARGS[@]}" \
        call cmd-run-tests \
        --kubeconfig="${HOME}/.kube" \
        --kind-svc="tcp://localhost:${KIND_PORT}" \
        --kind-cluster-name="${CLUSTER_NAME}" \
        --project-dir="file://${REPO_ROOT}" \
        --suites="${SUITES}" \
        --image-tag="${IMAGE_TAG}" \
        --chart-version="${CHART_VERSION}" \
        --debug-logs="${DEBUG_LOGS}" \
        --name-prefix="${NAME_PREFIX}" \
        ${BASELINE_ARGS[@]+"${BASELINE_ARGS[@]}"} \
        ${USE_CONFIG_IMAGE:+--use-config-image} \
        ${CONTAINER_REPORT_DIR:+--report-dir="${CONTAINER_REPORT_DIR}"} \
        2>&1 | tee "${LOG_FILE}"
    ) || dagger_exit=$?
    # keep a stable pointer to the latest run for convenience
    ln -sfn "${LOG_FILE}" "${LOG_DIR}/e2e-wizard-last.log"
    if [ "${dagger_exit}" -ne 0 ]; then
        err "Dagger failed (exit ${dagger_exit}). Full log: ${LOG_FILE}"
        exit "${dagger_exit}"
    fi
    ok "e2e run finished successfully"
    if [ -n "$REPORT_DIR" ]; then
        say "Test report: ${REPO_ROOT}/${REPORT_DIR}/report.json"
    fi
    TESTS_RAN=true
fi

# ---------------------------------------------------------------- dev pod

stage "7/7 Dev pod"

launch_dev_pod() {
    say "Launching e2e dev pod (image: ${OPERATOR_IMAGE})..."
    (
        cd "${SCRIPT_DIR}"
        dagger --config="file://${CONFIG_FILE}" "${DAGGER_SECRET_ARGS[@]}" \
        call cmd-launch-dev-shell \
        --kubeconfig="${HOME}/.kube" \
        --kind-svc="tcp://localhost:${KIND_PORT}" \
        --kind-cluster-name="${CLUSTER_NAME}" \
        --image-tag="${IMAGE_TAG}" \
        2>&1
    ) || { err "Failed to launch dev pod"; return 1; }
    ok "Dev pod 'e2e-dev' is running"
    echo
    say "Enter the dev pod with:"
    echo "  kubectl exec -it e2e-dev -n default -- sh"
    echo
    say "The pod uses the operator image, mounts the project at /library,"
    say "and shares the operator's ServiceAccount and secrets."
}

if [ "$DEV_POD" = "y" ]; then
    launch_dev_pod
elif [ "$DEV_POD" != "n" ]; then
    # Default: prompt (unless --no-dev was passed)
    if [ "$TESTS_RAN" = true ]; then
        echo
    fi
    if [ "$(ask_yes "Launch a dev pod for interactive debugging?" "y")" = "y" ]; then
        launch_dev_pod
    else
        say "Skipping dev pod"
    fi
fi

if [ "$CREATED_CLUSTER" = true ]; then
    echo
    say "Cluster '${CLUSTER_NAME}' kept for reuse. Next time: $0 --cluster-name ${CLUSTER_NAME}"
    say "Delete it with: kind delete cluster --name ${CLUSTER_NAME}"
fi

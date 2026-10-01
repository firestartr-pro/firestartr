#!/usr/bin/env bash
set +x  # Keep credential-bearing shell assignments out of traces.
PORT=-1  # Populated later by the script
CLUSTER_NAME="${CLUSTER_NAME:-}"
CONFIG_FILE=${CONFIG_FILE:-}
KIND_CONFIG_FILE=${KIND_CONFIG_FILE:-}
CREATE_CLUSTER=false
AUTO=false
LAST_EXIT_CODE=0
COMMAND_WAIT_TIME=5
DELETE_CLUSTER_ON_FAILURE=false
TEST_SUITES=all
PROJECT_DIR="${PROJECT_DIR:-}"
IMAGE_TAG="default"
# Default chart version for e2e runs. Respect an environment-provided CHART_VERSION
# so callers can override the script-level default without passing the flag.
CHART_VERSION="${CHART_VERSION:-4.1.0}"
E2E_ORG=${E2E_ORG:-}
E2E_CUSTOMER=${E2E_CUSTOMER:-}
DEBUG_LOGS=false
wait_for() {
    local WAIT_TIME=$1
    for ((i=WAIT_TIME; i>0; i--)); do
        printf "\r⏱️  Starting in %d seconds... \e[K" "$i"
        sleep 1
    done
    printf "\r🚀 Starting now!\e[K\n"
}

check_dagger_version() {
    # Check if dagger is installed
    if ! command -v dagger &> /dev/null; then
        echo "❌ Dagger is not installed. Please install Dagger 0.21.8 or greater."
        echo "   Installation instructions: https://docs.dagger.io/install"
        exit 1
    fi

    # Get installed version
    local INSTALLED_VERSION
    INSTALLED_VERSION=$(dagger version 2>&1 | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | sed 's/v//')
    local MINIMUM_VERSION="0.21.8"

    # Compare versions (convert to comparable integers)
    local INSTALLED_MAJOR
    INSTALLED_MAJOR=$(echo "$INSTALLED_VERSION" | cut -d. -f1)
    local INSTALLED_MINOR
    INSTALLED_MINOR=$(echo "$INSTALLED_VERSION" | cut -d. -f2)
    local INSTALLED_PATCH
    INSTALLED_PATCH=$(echo "$INSTALLED_VERSION" | cut -d. -f3)
    
    local MINIMUM_MAJOR
    MINIMUM_MAJOR=$(echo "$MINIMUM_VERSION" | cut -d. -f1)
    local MINIMUM_MINOR
    MINIMUM_MINOR=$(echo "$MINIMUM_VERSION" | cut -d. -f2)
    local MINIMUM_PATCH
    MINIMUM_PATCH=$(echo "$MINIMUM_VERSION" | cut -d. -f3)

    # Version comparison logic (lexicographic: major, then minor, then patch)
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

handle_command_failure() {
    local EXIT_CODE=$1
    
    if [ "$EXIT_CODE" -ne 0 ]; then
        echo "❌ Command failed with exit code $EXIT_CODE."
        
        if [ "$DELETE_CLUSTER_ON_FAILURE" = true ]; then
            echo "🗑️ Deleting kind cluster ${CLUSTER_NAME}..."
            kind delete cluster --name "${CLUSTER_NAME}"
        fi
        
        echo "🛑 Aborting script execution."
        exit "$EXIT_CODE"
    fi
}

prompt_or_auto() {
    local PROMPT_MSG="$1"
    local ACTION_DESC="$2"

    if [ "$AUTO" = true ]; then
        {
            echo "🤖 Auto: ${ACTION_DESC}"
            wait_for "$COMMAND_WAIT_TIME"
        } >&2

        echo "continue"
    else
        prompt_continue_skip_abort "$PROMPT_MSG"
    fi
}

prompt_continue_skip_abort() {
    local PROMPT_MSG="$1"
    local RESPONSE

    # Loop until a valid response is given
    while true; do
        # -p: Display the prompt message
        # -r: Prevents backslashes from being interpreted (safer)
        # -i: Provides a default value (not used here, but useful)
        read -r -p "$PROMPT_MSG [y(es)/n(o)/a(bort)]: " RESPONSE

        # --- NEW DEFAULT HANDLING ---
        # 1. If RESPONSE is empty (user just pressed Enter), set it to "y".
        RESPONSE=${RESPONSE:-y}
        # ----------------------------

        # Convert input to lowercase for case-insensitive comparison
        # Using tr is compatible with older bash versions (macOS ships with bash 3.2)
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

# Check Dagger version before proceeding
check_dagger_version

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --wait-time | -w)
            COMMAND_WAIT_TIME="$2"
            shift 2 # Move past the flag AND its value
            ;;
        --delete-cluster-on-failure | -d)
            DELETE_CLUSTER_ON_FAILURE=true
            shift # Move to the next argument
            ;;
        --image | -i)
            IMAGE_TAG=$2
            shift 2 # Move to the next argument
            ;;
        --chart-version | -c )
            CHART_VERSION=$2
            shift # Move to the next argument
            ;;
        --auto-execute-script)
            AUTO=true
            shift # Move to the next argument
            ;;
        --debug-logs)
            DEBUG_LOGS=true
            shift # Move to the next argument
            ;;
        --kind-cluster-name | -k)
            CLUSTER_NAME="$2"
            shift 2 # Move past the flag AND its value
            ;;
        --kind-config)
            KIND_CONFIG_FILE="$2"
            shift 2 # Move past the flag AND its value
            ;;
        --help | -h)
            echo "Usage: $0 [--kind-cluster-name|-k <name>] [--kind-config <path>] [--delete-cluster-on-failure|-d] [--auto-execute-script] [--debug-logs] [--wait-time|-w <seconds>] [--image|-i <tag>] [--chart-version|-c <version>]"
            exit 0
            ;;
        *)
            # This captures unknown flags or positional arguments
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

if [ -z "$CLUSTER_NAME" ]; then
    RANDOM_SUFFIX=$(LC_ALL=C tr -dc 'a-z0-9' < /dev/urandom | head -c 8)
    CLUSTER_NAME="firestartr-kind-cluster-$RANDOM_SUFFIX"
    CREATE_CLUSTER=true
else
    if ! PORT=$(docker inspect --format='{{(index (index .NetworkSettings.Ports "6443/tcp") 0).HostPort}}' "$CLUSTER_NAME"-control-plane); then
        echo "❌ Could not find existing kind cluster named ${CLUSTER_NAME}. Please check the name and try again."
        exit 1
    fi
fi



# Create kind cluster if needed
if [ "$CREATE_CLUSTER" = true ]; then
    if [ "$AUTO" = true ]; then
        echo "🤖 Auto: Creating kind cluster ${CLUSTER_NAME}"
        wait_for "$COMMAND_WAIT_TIME"
        ACTION="continue"
    else
        ACTION=$(prompt_continue_skip_abort "⚠️ Create new kind cluster ${CLUSTER_NAME}?")
    fi

    case "$ACTION" in
        "continue")
            kind create cluster --name "${CLUSTER_NAME}"${KIND_CONFIG_FILE:+ --config="${KIND_CONFIG_FILE}"}
            LAST_EXIT_CODE=$?

            if [ "$LAST_EXIT_CODE" -eq 0 ]; then
                if ! PORT=$(docker inspect --format='{{(index (index .NetworkSettings.Ports "6443/tcp") 0).HostPort}}' "$CLUSTER_NAME"-control-plane); then
                    echo "❌ An error happened getting the port for cluster ${CLUSTER_NAME}. Please relaunch the script (you can use the flag '--kind-cluster-name ${CLUSTER_NAME}' to avoid creating a new cluster)"
                    exit 1
                fi
                echo "✅ Kind cluster ${CLUSTER_NAME} created. Port: ${PORT}."
            fi
            ;;
        "skip")
            echo "🛑 Skipping the cluster creation is not allowed. Please provide an existing cluster name via the --kind-cluster-name flag to skip this step"
            exit 1
            ;;
        "abort")
            echo "🛑 Aborting script execution now."
            exit 1
            ;;
    esac
fi

if [ -z "${CONFIG_FILE:-}" ]; then
    echo 'An e2e config file is required to load test credentials.' >&2
    exit 1
fi
[[ "$CONFIG_FILE" = /* ]] || CONFIG_FILE="${PWD}/${CONFIG_FILE}"
if [[ -n "$PROJECT_DIR" && "$PROJECT_DIR" != /* && "$PROJECT_DIR" != file://* ]]; then
    PROJECT_DIR="${PWD}/${PROJECT_DIR}"
fi
[[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]] || {
    echo 'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set in the environment.' >&2
    exit 1
}
export AWS_SESSION_TOKEN="${AWS_SESSION_TOKEN:-}"

SELF="${BASH_SOURCE[0]}"
while [ -L "$SELF" ]; do
    DIR="$(cd "$(dirname "$SELF")" && pwd)"
    SELF="$(readlink "$SELF")"
    case "$SELF" in /*) ;; *) SELF="${DIR}/${SELF}" ;; esac
done
SCRIPT_DIR="$(cd "$(dirname "$SELF")" && pwd)"
source "${SCRIPT_DIR}/load-e2e-auth.sh"
CONFIG_ORG="$(e2e_config_value "$CONFIG_FILE" org)" || { echo 'e2e test credential config invalid (details suppressed)' >&2; exit 1; }
CONFIG_CUSTOMER="$(e2e_config_value "$CONFIG_FILE" customer)" || { echo 'e2e test credential config invalid (details suppressed)' >&2; exit 1; }
CONFIG_REGION="$(e2e_config_value "$CONFIG_FILE" region)" || { echo 'e2e test credential config invalid (details suppressed)' >&2; exit 1; }
EFFECTIVE_ORG="${E2E_ORG:-$CONFIG_ORG}"
EFFECTIVE_CUSTOMER="${E2E_CUSTOMER:-$CONFIG_CUSTOMER}"
fetch_e2e_test_credentials "$EFFECTIVE_CUSTOMER" "$EFFECTIVE_ORG" "$CONFIG_REGION" || exit 1

DAGGER_ARGS=(
    "--config=file:${CONFIG_FILE}"
    "--aws-access-key=env:AWS_ACCESS_KEY_ID"
    "--aws-secret-access-key=env:AWS_SECRET_ACCESS_KEY"
    "--aws-session-token=env:AWS_SESSION_TOKEN"
    "--github-app-id=env:GITHUB_APP_ID"
    "--github-app-pem-file=env:GITHUB_APP_PEM_FILE"
    "--prefapp-bot-pat=env:PREFAPP_BOT_PAT"
)

# Invoke from the module directory while leaving Dagger output visible.
(
    cd "$SCRIPT_DIR" || exit 1
    dagger "${DAGGER_ARGS[@]}" \
        call cmd-run-tests \
        --kubeconfig="${HOME}/.kube" \
        --kind-svc="tcp://localhost:${PORT}" \
        --kind-cluster-name="${CLUSTER_NAME}" \
        --project-dir="${PROJECT_DIR}" \
        --suites="${TEST_SUITES}" \
        --image-tag="${IMAGE_TAG}" \
        --chart-version="${CHART_VERSION}" \
        --debug-logs="${DEBUG_LOGS}" \
        --customer="${EFFECTIVE_CUSTOMER}" \
        --org="${EFFECTIVE_ORG}"
)

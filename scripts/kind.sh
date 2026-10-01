#!/bin/bash

set -e

# Cluster configuration
KIND_NAME="firestartr"
CHART_NAME="firestartr"
CHART_WEBHOOK_SERVICE="firestartr-controller-hook"
IMAGE_NAME="firestartr-controller"
IMAGE_TAG="latest"

# Path configuration
LOCAL_DEV_PATH="$(pwd)"
CONTAINER_PATH="/development"
CHART_PATH="${CHART_PATH:-$HOME/projects/prefapp/charts/charts/firestartr-controller}"
VALUES_PATH="helm/firestartr-controller/values.yaml"

# Defaults
DEFAULT_REPO_STATE_PATH="./"
DEFAULT_NAMESPACE="dev"

# Load environment variables from .env
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Load ORG from .env (required)
ORG="${ORG:-}"

# Load CUSTOMER from .env (required for AWS SSM paths)
CUSTOMER="${CUSTOMER:-}"

# Load GitHub App credentials from .env
GITHUB_APP_ID="${GITHUB_APP_ID:-}"
GITHUB_APP_INSTALLATION_ID="${GITHUB_APP_INSTALLATION_ID:-}"

# Load Chart Version (optional - if not set, uses local chart)
CHART_VERSION="${CHART_VERSION:-}"

# Load CRDs Version (required)
CRDS_VERSION="${CRDS_VERSION:-}"

touch .env.secrets.yaml

# Validation function
validate_env_vars() {
  local missing=()

  # Check ORG
  if [ -z "$ORG" ]; then
    missing+=("ORG (GitHub organization name)")
  fi

  # Check AWS credentials
  if [ -z "$AWS_ACCESS_KEY_ID" ]; then
    missing+=("AWS_ACCESS_KEY_ID (AWS credential for external-secrets)")
  fi

  if [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
    missing+=("AWS_SECRET_ACCESS_KEY (AWS credential for external-secrets)")
  fi

  # Check CUSTOMER
  if [ -z "$CUSTOMER" ]; then
    missing+=("CUSTOMER (AWS SSM customer name, e.g., 'my-customer')")
  fi

  # Check GitHub credentials
  if [ -z "$GITHUB_APP_ID" ]; then
    missing+=("GITHUB_APP_ID (GitHub App ID from app settings)")
  fi

  if [ -z "$GITHUB_APP_INSTALLATION_ID" ]; then
    missing+=("GITHUB_APP_INSTALLATION_ID (Installation ID for org ${ORG})")
  fi

  # Check CRDS_VERSION
  if [ -z "$CRDS_VERSION" ]; then
    missing+=("CRDS_VERSION (CRDs version, e.g., 'v1.53.1')")
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    {
      echo "========================================"
      echo "Error: Missing required environment variables in .env"
      echo "========================================"
      echo ""
      printf '  ❌ %s\n' "${missing[@]}"
      echo ""
      echo "Please update your .env file based on .env.example"
      echo "Current ORG: $ORG"
      echo "========================================"
    } >&2
    exit 1
  fi

  # Validate AWS credentials are working
  echo "🔍 Validating AWS credentials..."
  if ! aws sts get-caller-identity > /dev/null 2>&1; then
    {
      echo "❌ AWS credentials validation failed!"
      echo ""
      echo "Your AWS credentials are invalid or expired."
      echo "Please check:"
      echo "  - AWS_ACCESS_KEY_ID is correct"
      echo "  - AWS_SECRET_ACCESS_KEY is correct"
      echo "  - AWS_SESSION_TOKEN is valid (if using temporary credentials)"
      echo ""
      echo "Testing credentials:"
      aws sts get-caller-identity 2>&1 | head -10
      echo ""
    } >&2
    exit 1
  fi

  local aws_identity
  aws_identity=$(aws sts get-caller-identity --output json 2>/dev/null)
  local aws_account
  aws_account=$(echo "$aws_identity" | grep -o '"Account": "[^"]*"' | cut -d'"' -f4)
  local aws_user
  aws_user=$(echo "$aws_identity" | grep -o '"Arn": "[^"]*"' | cut -d'"' -f4 | sed 's/.*\///')

  echo "✅ AWS credentials are valid:"
  echo "   - Account: $aws_account"
  echo "   - User/Role: $aws_user"
  echo ""

  # Success message
  echo "✅ All required environment variables are set:"
  echo "   - ORG: $ORG"
  echo "   - CUSTOMER: $CUSTOMER"
  echo "   - GITHUB_APP_ID: ${GITHUB_APP_ID}"
  echo "   - GITHUB_APP_INSTALLATION_ID: $GITHUB_APP_INSTALLATION_ID"
  echo "   - CRDS_VERSION: $CRDS_VERSION"
  echo ""
}

# Validate chart path exists when using local chart
validate_chart_path() {
  if [ -z "$CHART_VERSION" ]; then
    echo "🔍 Validating local chart path..."
    if [ ! -d "$CHART_PATH" ]; then
      {
        echo "========================================"
        echo "Error: Local chart directory not found"
        echo "========================================"
        echo ""
        echo "Expected path: $CHART_PATH"
        echo ""
        echo "The local chart directory does not exist."
        echo "This usually means:"
        echo "  1. The charts repository is not cloned in the expected location"
        echo "  2. You're running the script from the wrong directory"
        echo ""
        echo "Solutions:"
        echo "  - Clone the charts repo: git clone https://github.com/prefapp/charts ../charts"
        echo "  - Or set CHART_VERSION in .env to use a published chart version"
        echo "========================================"
      } >&2
      exit 1
    fi
    echo "✅ Local chart directory exists: $CHART_PATH"
    echo ""
  fi
}

# Create temporary provider config values file
create_provider_config_values() {
  local temp_file
  temp_file=$(mktemp)

  cat > "$temp_file" <<EOF
providerConfigs:
  github-${ORG}:
    config: |
      {
        "owner": "${ORG}",
        "app_auth": {
          "id": "${GITHUB_APP_ID}",
          "installation_id": "${GITHUB_APP_INSTALLATION_ID}",
          "pem_file": "\${{ secrets.GITHUB_APP_PEM_FILE }}"
        }
      }
    secrets:
      GITHUB_APP_PEM_FILE:
        secretRef:
          key: github-app-pem-file
          secretStoreKeyRef: /firestartr/${CUSTOMER}/fs-${CUSTOMER}/pem
    type: github
    source: integrations/github
    version: "~> 6.0"
EOF

  echo "$temp_file"
}

# Run helm with common arguments
run_helm_template() {
  local release_name="$1"
  local temp_values="$2"
  shift 2

  helm template "$release_name" "$CHART_PATH" \
    --values "$VALUES_PATH" \
    --values "$temp_values" \
    --set "org=${ORG}" \
    --set "controller.secretStoreKeysRefs.githubAppPem=/firestartr/${CUSTOMER}/fs-${CUSTOMER}/pem" \
    --set "controller.secretStoreKeysRefs.githubAppId=/firestartr/${CUSTOMER}/fs-${CUSTOMER}/app-id" \
    --set "general.image=${IMAGE_NAME}:${IMAGE_TAG}" \
    --set "containerPath=${CONTAINER_PATH}" \
    --namespace "${DEFAULT_NAMESPACE}" \
    "$@"
}

# Validate Helm values and templates
validate_helm_templates() {
  echo "🔍 Validating Helm templates..."

  local TEMP_VALUES
  TEMP_VALUES=$(create_provider_config_values)

  # Render templates with helm template (dry-run)
  if ! run_helm_template test-validation "$TEMP_VALUES" > /dev/null 2>&1; then
    echo "❌ Helm template validation failed!" >&2
    echo "Running helm template to show errors:" >&2
    echo "" >&2

    run_helm_template test-validation "$TEMP_VALUES" 2>&1 | head -50

    rm -f "$TEMP_VALUES"
    exit 1
  fi

  rm -f "$TEMP_VALUES"
  echo "✅ Helm templates validated successfully"
  echo ""
}

function create_kind_cluster() {
  CONTAINER_PATH="/development"

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
    kubectl delete pod -l app=$IMAGE_NAME
  fi
}


function helm_install(){
  helm repo add argo https://argoproj.github.io/argo-helm
  helm repo add external-secrets https://charts.external-secrets.io
  helm repo add firestartr-controller-kind https://prefapp.github.io/charts/firestartr-controller

  helm repo update

  helm install argocd argo/argo-cd --version 7.7.6 -n argocd --values helm/argocd/values.yaml
  helm install argo-events argo/argo-events --version 2.4.16 -n argocd

  helm install external-secrets --version 0.20.2 \
    -n external-secrets --create-namespace \
    --values helm/external-secrets/values.yaml external-secrets/external-secrets

  # Wait for external-secrets CRDs to be registered and usable
  echo "Waiting for external-secrets CRDs to be ready..."
  timeout=300
  elapsed=0
  while [ $elapsed -lt $timeout ]; do
    if kubectl get crd externalsecrets.external-secrets.io secretstores.external-secrets.io clustersecretstores.external-secrets.io &>/dev/null; then
      # CRDs exist, now verify they're actually usable by checking the API
      if kubectl api-resources 2>/dev/null | grep -q "secretstores"; then
        echo "External-secrets CRDs are ready and available"
        break
      fi
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  if [ $elapsed -ge $timeout ]; then
    echo "Timeout waiting for external-secrets CRDs"
    exit 1
  fi

  kubectl create namespace "$DEFAULT_NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
  kubectl create secret generic firestartr-firestartr-controller --from-env-file=.env -n "$DEFAULT_NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

  local TEMP_VALUES
  TEMP_VALUES=$(create_provider_config_values)

  source ./scripts/cert.sh "$CHART_NAME-$CHART_WEBHOOK_SERVICE" "$DEFAULT_NAMESPACE"

  # Determine chart source (local or published)
  local CHART_SOURCE
  local VERSION_ARGS=()
  if [ -z "$CHART_VERSION" ]; then
    echo "📦 Using local chart from: $CHART_PATH"
    CHART_SOURCE="$CHART_PATH"
  else
    echo "📦 Using published chart version: $CHART_VERSION"
    CHART_SOURCE="firestartr-controller-kind/firestartr-controller"
    VERSION_ARGS=(--version "$CHART_VERSION")
  fi

  helm upgrade --install "$CHART_NAME" "$CHART_SOURCE" "${VERSION_ARGS[@]}" \
    --values "$VALUES_PATH" \
    --values "$TEMP_VALUES" \
    --set "org=${ORG}" \
    --set "controller.secretStoreKeysRefs.githubAppPem=/firestartr/${CUSTOMER}/fs-${CUSTOMER}/pem" \
    --set "controller.secretStoreKeysRefs.githubAppId=/firestartr/${CUSTOMER}/fs-${CUSTOMER}/app-id" \
    --set "general.image=${IMAGE_NAME}:${IMAGE_TAG}" \
    --set "containerPath=${CONTAINER_PATH}" \
    --namespace "${DEFAULT_NAMESPACE}" \
    --create-namespace

  # Clean up temp file
  rm -f "$TEMP_VALUES"
}

function install_crds(){
  echo "📦 Installing CRDs version: $CRDS_VERSION"
  curl "https://raw.githubusercontent.com/firestartr-pro/docs/refs/heads/main/site/raw/core/crds/${CRDS_VERSION}/index.yaml" | kubectl apply -f -
  kubectl apply -f packages/k8s/src/crds
}


main () {
  case "${1:-}" in
    create)

      REPO_STATE_PATH="${2:-$DEFAULT_REPO_STATE_PATH}"

      # Validate environment variables early (before building Docker image)
      echo "🔍 Validating environment variables..."
      validate_env_vars

      # Validate chart path exists when using local chart
      validate_chart_path

      # Validate Helm templates early (before building Docker image)
      validate_helm_templates

      # Check if kind cluster already exists. Exact name match.
      if cluster_exists; then
        echo "Kind cluster already exists"
      else
        echo "Creating kind cluster..."
        create_kind_cluster
        build_and_load_image
        kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
        install_crds
        helm_install

        # Create argocd app
        kubectl apply -n argocd -f - <<-EOF
          apiVersion: argoproj.io/v1alpha1
          kind: Application
          metadata:
            name: firestartr-dev
          spec:
            project: default
            source:
              repoURL: https://github.com/firestartr-test/local-development-state
              targetRevision: HEAD
              path: $REPO_STATE_PATH
            destination:
              server: https://kubernetes.default.svc
              namespace: dev
            syncPolicy:
              automated: {}
              syncOptions:
              - CreateNamespace=true
EOF

        # we could print the initial password here, but it's not available yet
        echo "Get the initial password using kubectl get secrets -n argocd argocd-initial-admin-secret --template={{.data.password}} | base64 -d"
        echo "Forward the argocd server port using kubectl port-forward svc/argocd-server -n argocd 8080:443"
        echo "ArgoCD UI: http://localhost:8080"
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
      echo "  $0 install-release" >&2
      echo "  $0 install-crds" >&2
      exit 1
  esac
}

if [ ! -f .env ]; then
  echo ".env file not found! Please create one based on .env.example"
  exit 1
fi

main "$@"

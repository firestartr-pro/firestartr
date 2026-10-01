# E2E Dagger Module

This module boots a Firestartr operator in a Kind cluster through the private `firestartr-core` Dagger module, mounts this repository, and runs the `packages/e2e` test suites.

## Quick start (wizard)

The easiest way to run the e2e locally is the interactive wizard:

```bash
./wizard.sh
```

It asks for every parameter with sensible defaults (just press Enter), writes
non-sensitive settings to `.local/e2e.yaml`, and passes AWS credentials to Dagger
as environment-backed Secret handles. It creates or reuses a Kind cluster,
builds or loads the operator image, installs CRDs, loads test-only GitHub
credentials from AWS SSM SecureStrings, and invokes `dagger call cmd-run-tests`.

Useful variants:

```bash
./wizard.sh --suite terraform          # pick the suite up front
./wizard.sh --cluster-name e2e-local   # reuse an existing cluster
./wizard.sh --yes                      # non-interactive, accept all defaults
./wizard.sh --delete-cluster-on-exit   # tear the cluster down afterwards
```

See `./wizard.sh --help` for all flags. The rest of this document explains what
the wizard does under the hood.

## Current module entrypoints

- `cmd-run-tests`: boots the operator and runs one or more e2e suites
- `cmd-terminal-tests`: boots the operator and returns a prepared container for interactive debugging
- `cmd-launch-dev-pod`: launches a Firestartr dev pod through `firestartr-core`

## Requirements

- [Dagger CLI](https://docs.dagger.io/install) matching `dagger/etoe/dagger.json` (currently `v0.21.8`)
- [Docker](https://docs.docker.com/engine/install/)
- [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)
- Git credentials with access to `<your-org>/daggerverse-private` so Dagger can resolve the private `firestartr` dependency
- AWS credentials in the environment, with permission to read and decrypt the customer's test GitHub app-id, PEM, and bot PAT SecureStrings from SSM

You do not need Go to run the module. Go is only needed if you want to modify the module implementation.

## Config file

Create your config locally with the following command:

```bash
cp ../../.github/e2e.yaml .local
```

Use `.github/e2e.yaml` as the baseline. Its shape is:

```yaml
---
org: "firestartr-e2e"
customer: "firestartr-e2e"
cluster: "kind" # currently unused by the module; use --kind-cluster-name at runtime
operator:
  # CI overrides this from .github/workflows/e2e.yaml
  chartVersion: "4.2.2"
  # imageTag: "v1.54.0_full-aws" # uncomment for local execution, or pass --image-tag
credentials:
  region: "eu-west-1"
  # For local execution
  # accessKey: ""
  # secretKey: ""
  # token: ""
  # For GitHub Actions OIDC
  roleArn: "arn:aws:iam::<AWS_ACCOUNT_ID>:role/<your-role-name>"
```

Notes:

- AWS credentials must be passed with `--aws-access-key`, `--aws-secret-access-key`, and `--aws-session-token` as Dagger Secret handles; credentials embedded in config files are rejected
- `operator.imageTag` must match the operator image you want to run; pass `--image-tag` to override it at runtime
- `--use-config-image=true` makes the operator use pull policy `IfNotPresent`; otherwise the module uses `Never` and expects the image to already exist in the Kind cluster
- `cmd-run-tests` now treats `--kind-cluster-name`, `--image-tag`, and `--chart-version` as optional CLI overrides
- current local and CI commands still pass `--kind-cluster-name` explicitly

## Required Kind Cluster Actions

Before running `cmd-run-tests` or `cmd-terminal-tests` against a Kind cluster, prepare the cluster:

1. Install the Firestartr CRDs into the cluster.
2. Make the operator image available inside Kind unless you use `--use-config-image=true`.

By default, the module uses pull policy `Never`, so the image referenced by `operator.imageTag` or `--image-tag` must already be loaded into Kind. For example, from the repository root:

```bash
E2E_IMAGE_TAG="e2e-local"

docker build \
  --file docker/full-aws.Dockerfile \
  --tag "ghcr.io/firestartr-pro/firestartr:${E2E_IMAGE_TAG}" \
  .

kind load docker-image "ghcr.io/firestartr-pro/firestartr:${E2E_IMAGE_TAG}" --name "${KIND_CLUSTER_NAME}"
kubectl apply -f packages/k8s/src/crds/
```

With `--use-config-image=true`, Kind does not need the image preloaded, but the configured image must be pullable from inside the cluster. The CRD installation step is still required. The local command below uses this mode; when using the locally built image instead, omit the flag and pass `--image-tag="e2e-local"`.

## Run locally

Create a Kind cluster and capture the Kubernetes API port:

```bash
KIND_CLUSTER_NAME="e2e-firestartr"
kind create cluster --name "${KIND_CLUSTER_NAME}"
KIND_PORT=$(docker inspect --format='{{(index (index .NetworkSettings.Ports "6443/tcp") 0).HostPort}}' "${KIND_CLUSTER_NAME}-control-plane")
```

Install the Firestartr CRDs into the cluster.

```bash
kubectl apply -f ../../packages/k8s/src/crds/
```

Then complete the required Kind cluster actions described above, and run the module from `dagger/etoe`:

```bash
CONFIG_FILE="$(pwd)/.local/e2e.yaml"
PROJECT_DIR="$(pwd)/../.."
# Export AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_SESSION_TOKEN first.
source ./load-e2e-auth.sh
CONFIG_ORG="$(e2e_config_value "$CONFIG_FILE" org)"
CONFIG_CUSTOMER="$(e2e_config_value "$CONFIG_FILE" customer)"
CONFIG_REGION="$(e2e_config_value "$CONFIG_FILE" region)"
fetch_e2e_test_credentials "$CONFIG_CUSTOMER" "$CONFIG_ORG" "$CONFIG_REGION"

dagger \
  --config="file://${CONFIG_FILE}" \
  --aws-access-key="env:AWS_ACCESS_KEY_ID" \
  --aws-secret-access-key="env:AWS_SECRET_ACCESS_KEY" \
  --aws-session-token="env:AWS_SESSION_TOKEN" \
  --github-app-id="env:GITHUB_APP_ID" \
  --github-app-pem-file="env:GITHUB_APP_PEM_FILE" \
  --prefapp-bot-pat="env:PREFAPP_BOT_PAT" \
  call cmd-run-tests \
  --kubeconfig="${HOME}/.kube" \
  --kind-svc="tcp://localhost:${KIND_PORT}" \
  --kind-cluster-name="${KIND_CLUSTER_NAME}" \
  --project-dir="file://${PROJECT_DIR}" \
  --suites="github" \
  --use-config-image
```

Notes:

- `--project-dir` must point to the repository root because the module mounts the repo and runs `npm install` there
- omit `--image-tag` and `--chart-version` to keep the values from the config file; pass them only when you want to override the config at runtime
- `--org` and `--customer` are also optional runtime overrides for the config values
- `--crd-upgrade-baseline-version` is optional and defaults to `latest`; it is the CRD manifest selector only
- `--crd-upgrade-baseline-operator-image-tag` is required whenever the CRD upgrade path runs (`--suites=crd-upgrade`, `--suites=all`, or a selector list containing `crd-upgrade`); resolve it before invoking Dagger (for example, workflow resolves `latest` from `.release-please-manifest.json` field `"."` and passes `v2.4.0_full-aws`)
- `--debug-logs=true` switches test logging to debug level
- if you do not use `--use-config-image=true`, make sure the exact operator image tag is already loaded into Kind before you run Dagger
- when the CRD upgrade path runs, load both `ghcr.io/firestartr-pro/firestartr:<crd-upgrade-baseline-operator-image-tag>` and the target `ghcr.io/firestartr-pro/firestartr:<image-tag>` into Kind; never use `latest_full-aws` as the baseline operator image tag
- if you use `--use-config-image=true`, the cluster must be able to pull the configured image by itself, but you still need to apply the CRDs first

Current suite values are:

- The names of the directories in `__tests__/`
- The special: `all`, to run the CRD upgrade orchestration first and then the normal all specs in `__tests__/`; `crd-upgrade` suite.

## GitHub Actions / OIDC

In CI, `aws-actions/configure-aws-credentials` exchanges GitHub OIDC for
short-lived AWS credentials outside Dagger. The workflow fetches test-only
GitHub credentials from SSM SecureStrings, then passes AWS and GitHub credentials
to Dagger only as environment-backed Secret handles.

CI performs the same required Kind cluster actions before invoking Dagger:

```bash
kind load docker-image "ghcr.io/firestartr-pro/firestartr:${E2E_IMAGE_TAG}" --name "${E2E_KIND_CLUSTER_NAME}"
kubectl apply -f project-dir/packages/k8s/src/crds/
```

The current CI flow builds an `e2e-local` operator image, loads it into Kind, and relies on the default `--use-config-image=false` behavior so the operator uses pull policy `Never`.

The workflow loads the test credentials from SSM and passes Secret handles
before `call`:

```bash
source ./load-e2e-auth.sh
CONFIG_FILE="${GITHUB_WORKSPACE}/project-dir/.github/e2e.yaml"
CONFIG_ORG="$(e2e_config_value "$CONFIG_FILE" org)"
CONFIG_CUSTOMER="$(e2e_config_value "$CONFIG_FILE" customer)"
CONFIG_REGION="$(e2e_config_value "$CONFIG_FILE" region)"
fetch_e2e_test_credentials "$CONFIG_CUSTOMER" "$CONFIG_ORG" "$CONFIG_REGION"

dagger \
  --config="file://${CONFIG_FILE}" \
  --aws-access-key="env:AWS_ACCESS_KEY_ID" \
  --aws-secret-access-key="env:AWS_SECRET_ACCESS_KEY" \
  --aws-session-token="env:AWS_SESSION_TOKEN" \
  --github-app-id="env:GITHUB_APP_ID" \
  --github-app-pem-file="env:GITHUB_APP_PEM_FILE" \
  --prefapp-bot-pat="env:PREFAPP_BOT_PAT" \
  call cmd-run-tests \
  --kubeconfig="${HOME}/.kube" \
  --kind-svc="tcp://localhost:${KIND_PORT}" \
  --kind-cluster-name="${KIND_CLUSTER_NAME}" \
  --project-dir="file://${PROJECT_DIR}" \
  --suites="github" \
  --image-tag="e2e-local" \
  --chart-version="3.5.0"
```

See `.github/workflows/e2e.yaml` for the repository's current CI wiring and `.github/e2e.yaml` for the current default config values.

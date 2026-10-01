# E2E Module Context

The e2e module (`dagger/etoe/`) manages end-to-end testing of the firestartr operator against real Kind clusters. It orchestrates cluster creation, operator deployment, CRD installation, and test execution via Dagger pipelines.

## Language

**Dev Pod**:
A persistent pod inside the e2e Kind cluster that runs `tail -f /dev/null`, mounts the project at `/library`, and shares the operator's ServiceAccount and secrets. Developers enter it via `kubectl exec` to run arbitrary e2e commands.
_Avoid_: debug pod, shell pod, dev shell

**Test Container**:
A Dagger-managed container outside the Kind cluster that runs the e2e test suite. Connected to the cluster via service binding and kubeconfig. Not the same as the Dev Pod.
_Avoid_: test pod, runner

**Bridge Container**:
A lightweight Alpine container with kubectl that connects to the Kind cluster via service binding. Used for kubectl operations from Dagger.
_Avoid_: proxy, relay

**Operator Image**:
The full Docker image built from `docker/full-aws.Dockerfile`, published to `ghcr.io/firestartr-pro/firestartr:<tag>`. Contains nodejs, kubectl, curl, jq, vim, and all operator dependencies.
_Avoid_: controller image, runtime image

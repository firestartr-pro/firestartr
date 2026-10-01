# E2E Dev Pod — Persistent In-Cluster Debug Shell

The e2e module needs a persistent development pod inside the Kind cluster that mounts the project volume, runs `tail -f /dev/null`, and lets developers run arbitrary e2e commands via `kubectl exec`.

## Considered Options

- **Inside vs outside the cluster**: The existing test container runs outside the cluster (Dagger container + service binding). An in-cluster pod shares the operator's network, can reach webhooks, ArgoCD, and in-cluster secrets — scenarios the outside container cannot test.
- **Ephemeral vs persistent**: Ephemeral pods (created on demand, destroyed on detach) force re-creation on every debug session. A persistent pod survives operator restarts and CRD re-applies, which is the common debug loop.
- **Image choice**: The operator image (`ghcr.io/firestartr-pro/firestartr:<tag>`) already contains nodejs, kubectl, curl, jq, vim, and all tools needed for debugging. A lighter image would require installing tools on every pod creation.
- **RBAC**: The dev pod uses the same ServiceAccount, ClusterRole, and ClusterRoleBinding the operator Helm chart creates. This ensures the pod can do everything the operator can — reconcile CRs, manage finalizers, list/watch resources — without over-privileging with cluster-admin. If the pod can't do something the operator can, the debug session has lost its purpose.
- **Secrets**: The dev pod mounts the same Kubernetes Secret the operator uses (Helm-deployed in `default` namespace). An independent copy would drift on secret rotation and mask credential-related bugs.

## Consequences

- The dev pod (`e2e-dev`) persists across sessions in the `default` namespace until explicitly deleted.
- Developers enter via `kubectl exec -it e2e-dev -- sh`.
- The volume mount path is `/library`, consistent with all other pods in the ecosystem (`dev-operator.sh`, Helm values, local-dev).
- The pod shares the operator's RBAC and secrets, so permission and credential debugging is faithful to production.
- The Dagger command (`CmdLaunchDevShell`) discovers the operator's ServiceAccount and secret dynamically from the running deployment (by labels `app=firestartr-controller, concern=controller`), generates the pod YAML, and applies it via kubectl from a bridge container.
- A shell script wrapper (`dev.sh`) handles the interactive lifecycle for standalone use.

## Kind Cluster Configuration

The e2e Kind cluster is always created with `extraMounts` that map the project root (`$REPO_ROOT`) to `/development` inside the Kind node. This is required for:
- The dev pod's `/library` volume mount (hostPath `/development` → pod `/library`)
- The operator's Helm chart volume mounts (same pattern)

When the `k8s-rate-limits` suite is selected, API server rate limits (`max-requests-inflight`, `max-mutating-requests-inflight`) are applied **after** the cluster bootstraps by patching the kube-apiserver static pod manifest. This avoids breaking `kubeadm init`, which itself needs to make API calls (e.g., creating ClusterRoleBindings) during bootstrap — rate limits applied via `kubeadmConfigPatches` throttle these internal calls and cause `wait-control-plane` failures.

The `--new-cluster` flag forces deletion of any existing cluster and creates a fresh one with the proper config.

## Wizard Integration

The interactive wizard (`wizard.sh`) offers the dev pod as an addition to the test run, not a replacement.

**CLI flags:**
- `--dev` — skip tests, launch dev pod directly (useful for reusing an existing cluster)
- `--no-dev` — skip the post-test dev pod prompt

**Interactive flow (default):**
- Stage 6/7: Run e2e tests (unchanged)
- Stage 7/7: Prompt `Launch a dev pod for interactive debugging? [y/N]` — default yes

**Usage examples:**
```bash
./wizard.sh                          # run tests, then prompt for dev pod
./wizard.sh --dev                    # skip tests, launch dev pod directly
./wizard.sh --no-dev                 # run tests, skip dev pod prompt
./wizard.sh --suite github --dev     # (future: run github tests then dev pod)
```

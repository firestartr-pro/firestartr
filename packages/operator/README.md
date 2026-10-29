# Demo operator

## Requirements

* kubectl installed
* docker installed
* kind installed
* A Github PAT created

## To initialize the kind cluster and local container

In the root directory of the repository:

```shell
bash kind.sh create   
```
Go to k9s and open a shell in the firestartr-local container

![k9s with the firestartr-local pod selected](docs/operator.png)

Execute in the container

```
export TOKEN_GITHUB=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

cd /home/app

./scripts/init.sh ${TOKEN_GITHUB}
```

## Plan mode

Plan mode runs the operator so that it plans every CR it watches and never
applies, destroys or writes anything to the cluster or GitHub. It can run next
to the live operator, for example to try a candidate version or to audit drift.

Turn it on with either:

```shell
firestartr-cli operator --start controller --plan-mode [--plan-output-dir /data/plans]
```

or by setting `OPERATOR_PLAN_MODE=true` in the operator pod. The variable only
accepts `true` or `false`; any other value stops the operator at startup. Plan
mode is fixed at startup.

For each CR it writes `<plan-output-dir>/<kind>/<name>.md` (summary header and
the plan text) and `.json` (the same header and the `show -json` plan),
overwriting the previous plan. The default directory is `/tmp/plans`; mount a
volume there to keep plans beyond the pod's lifetime. It also logs one line per
plan:

```
PLAN FirestartrTerraformWorkspace/my-ws UPDATED: +0 ~2 -0 (/tmp/plans/FirestartrTerraformWorkspace/my-ws.md)
```

- The operation is chosen from the live operator's status, and
  `firestartr.dev/policy` / `firestartr.dev/sync-policy` filter it as usual.
  Anything the live operator would not do is recorded as `SKIPPED (<reason>)`,
  and failures as `ERROR <reason>`.
- Terraform plans run with `-lock=false` (`Lock: none`): they never block a
  live apply, and may read state in the middle of one.
- The leader-election Lease is not used.

See [ADR 0012](docs/adr/0012-plan-mode-is-read-only-and-lock-free.md).

## Apply manifests

* Open a new terminal
* From the git repository, go to `packages/k8s/__tests__/fixtures/groups`
* `kubectl apply -f group_a.yaml`

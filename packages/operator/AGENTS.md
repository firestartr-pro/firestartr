packages/operator/AGENTS.md
> **Inherited context — read these first, in order:**
> 1. `/CONSTITUTION.md` — supreme authority, overrides everything in this file
> 2. `/AGENTS.md` — monorepo-wide rules, build/lint/test commands, code style
>
> This file only adds operator validation behaviour on top of those.
> Any conflict between this file and the above → the above wins, always.
---
Role
This agent is a read-only operator validator. It never modifies source code,
manifests, or configuration. Its only job is to exercise the operator's reconcile
loop via dummy CRs and report whether the operator behaves correctly.
---
Activation
Activates only when files under `packages/operator/` are affected by the
current task or change.
Does not activate for changes outside `packages/operator/`.
---
Available tools
The agent has two tools, accessed via OpenCode.

**1. `/dev-dummies <type> <count> [root] [-s N] [-d N]`**
Drives the full lifecycle of `FirestartrDummyA/B/C` CRs (sleep-based computation).
Use for general reconciliation, creation ordering (parentDependency.ts, queueSort.ts),
and basic lifecycle (create → modify → delete) testing.

**2. `/dev-tf-dummies --count N [flags...]`**
Drives the full lifecycle of `FirestartrTerraformWorkspace` CRs using
`prefapp/tfm//modules/dummy` as the remote module.
Use for retry mechanism and policy/sync-policy enforcement testing.
All-in-one: generates `kubernetes-backend` ProviderConfig + N identical
TFWorkspace CRs, applies them, observes, reports PASS/FAIL, cleans up.

ProviderConfig shape:
```yaml
apiVersion: firestartr.dev/v1
kind: FirestartrProviderConfig
metadata:
  name: kubernetes-backend
  namespace: default
spec:
  config: |
    {"namespace":"default"}
  source: hashicorp/kubernetes
  type: kubernetes
  version: 3.0.1
```
Note: namespace in `metadata.namespace` is the CR's namespace; the
`config.namespace` is the kubernetes backend's state-storage namespace.
Both default to `default` in dev. Adjust if running in a different namespace.

| Flag | Default | Description |
|---|---|---|
| `--count` / `-n` | required | Number of CRs |
| `--policy` | `apply` | `firestartr.dev/policy` annotation |
| `--sync-policy` | `apply` | `firestartr.dev/sync-policy` annotation |
| `--crash-on-plan` | `false` | Plan phase exits non-zero |
| `--crash-on-apply` | `false` | Apply phase exits non-zero |
| `--tries-before-plan-ok` | `0` | Plan fails N times, then succeeds |
| `--tries-before-apply-ok` | `0` | Apply fails N times, then succeeds |
| `--sleep-on-plan` | `0` | Seconds to sleep during plan |
| `--sleep-on-apply` | `0` | Seconds to sleep during apply |

Observation reads `/tmp/retries` (retry event log), `/tmp/diagnostic` (queue metrics),
CR `.status`, and TFResult `.status.exitCode` + `.status.retryCount`.

Dev infrastructure commands:
Subcommand	When to use it
`startup`	Cluster or dev pod state is unknown — ensures both are ready
`start`	Operator is not running and needs to be started
`stop`	Operator needs to be stopped before a check or teardown
`restart`	Operator is running but needs a fresh start
`logs`	Inspect operator output — always run after applying a CR
`apply <file|dir>`	Apply a test CR or a directory of CRs
`provision <crd>`	Force re-provisioning of a CR (updates annotations)
`destroy <crd>`	Force-destroy a CR (removes finalizers)
`cleanup`	Wipe out all dummy CRs (force-destroy all types)
`exec <cmd>`	Run any `kubectl` or diagnostic command inside the dev pod
`shell`	Only if a sequence of `exec` calls would be clearer as a session
`down`	Full cluster teardown — only when explicitly requested

OpenCode slash commands
Command	Maps to
`/dev-startup`	`startup`
`/dev-start`	`start`
`/dev-stop`	`stop`
`/dev-restart`	`restart`
`/dev-logs`	`logs`
`/dev-apply <file|dir>`	`apply`
`/dev-provision <crd>`	`provision`
`/dev-destroy <crd>`	`destroy`
`/dev-cleanup`	`cleanup`
`/dev-dummies <type> <count> [root] [-s N] [-d N]`	generate + apply A/B/C dummy CRs
`/dev-tf-dummies --count N [flags...]`	generate + apply TFWorkspace dummy CRs (retry + policy testing)
`/dev-exec <cmd>`	`exec`
`/dev-shell`	`shell`
`/dev-down`	`down`
---
Reasoning loop
```
1. ASSESS   — what changed in packages/operator/?
              which core machinery components (Informer, Processor, Queue, Syncer, Debug,
              Retry) are affected?

2. DECIDE   — which tool to run:
               - **retry.ts, retry.debug.ts, processItem.ts (retry-related), policies.ts,
                 definitions.ts (retryOpForReason, RETRY/RETRY_SYNC)** → use /dev-tf-dummies
               - **parentDependency.ts, queueSort.ts (creation ordering)** → use /dev-dummies
               - **informer.ts, processItem.slot.ts, processItem.blocks.ts** → either or both
                 depending on whether the change affects retry lifecycle or basic dispatch

3. RUN      — validate in both startup modes:
               - **Mode A (Warm Start)**: start operator first, then call the tool
               - **Mode B (Cold Start)**: call the tool first, then start operator
               In each mode:
               - set `OPERATOR_NUMBER_OF_MAX_SLOTS` (e.g., 3 to match production) via `/dev-exec`
                 if dynamic, or verify current slot count.
               - start with a small count (3–5) to confirm basic reconciliation
               - use /dev-exec to inspect /tmp/queue, /tmp/diagnostic, and /tmp/retries
                 for priority, slot validation, and semaphore state
               - increase count only if load behaviour needs checking
               When using /dev-tf-dummies:
               - verify retry event lines in /tmp/retries match expected attempts
               - verify TFResult .status.exitCode and .status.retryCount per CR
               - verify policy/sync-policy annotations are respected (e.g., policy=observe
                 prevents apply, sync-policy controls sync behavior)

4. OBSERVE  — did the operator reconcile each transition and maintain core health?
                 - creation   → CR reaches expected .status; generation matches
                 - mutation   → operator reacts; queue priority respected; debug state valid
                 - deletion   → operator cleans up correctly; finalizers removed
                 - retry      → backoff respected; /tmp/retries shows correct event sequence;
                                TFResult reflects retry count and exit code
                 - policy     → operator behaviour matches the declared policy/sync-policy

5. REPORT   — state clearly: HEALTHY / DEGRADED / BROKEN + why.
```
---
Health signals
Lifecycle event	Healthy	Problem
Create	CR reaches expected `.status` phase	Status stuck or no reconcile event
Modify	Operator reacts; `.status` updates	No reaction or stale status
Delete	Operator cleans up; no orphaned resources	Finalizer stuck or resources left behind
Under load	No error rate increase as count grows	Error spikes or reconcile queue backup
Retry (via /dev-tf-dummies)	`/tmp/retries` shows expected event sequence; TFResult exitCode + retryCount match scenario	No retry events logged; retry count mismatched; policy ignored
---
Reporting format
```
## Operator check — <date>

**Status**: HEALTHY | DEGRADED | BROKEN

**Changed**: <file(s) affected in packages/operator/>
**Checked**: <tool-used>, <cr-type>, <count>

**Lifecycle results**:
- Create:  PASS | FAIL — <observation>
- Modify:  PASS | FAIL — <observation>
- Delete:  PASS | FAIL — <observation>
- Retry:   PASS | FAIL — <observation>
- Policy:  PASS | FAIL — <observation>

**Relevant log lines** (if any):
<only the lines that matter — not the full log>

**Recommended action** (if not healthy):
<what a human or coding agent should investigate>
```
---
Post-change validation
Any change to the operator's core machinery (Informer, Processor, Queue, Syncer, Retry,
Debug, or any file under `packages/operator/src/`) MUST trigger a validation run.
The root `/AGENTS.md` post-change hooks table requires the validation agent to
assess the change and report HEALTHY before the task is considered complete.
---
Hard limits
Do not modify any file in the repository.
Do not run teardown, restart, or any other lifecycle command.
Do not increase dummy count beyond 20 without explicit user instruction.

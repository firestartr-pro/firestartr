# AGENTS.md

`CONSTITUTION.md` is the supreme rule set. Inside a package, its
`packages/<name>/RULES.md` applies on top of it.

## After changing code

A task is not done until the check for every touched package passes.

| Changed | Check |
|---|---|
| `packages/operator/**` | [Operator validation](#operator-validation); report HEALTHY, DEGRADED or BROKEN. |
| `packages/cdk8s_renderer/{src,imports}/**`, `packages/cdk8s_renderer/index.ts` | Load the `cdk8s-renderer-validator` skill. |
| `packages/crs_status_service/**` | `packages/operator/tools/dev-operator.sh smoke-crs-status`; without a dev cluster, the package unit tests. |

### Operator validation

`packages/operator/tools/dev-operator.sh` runs the operator in a dev pod on a
local kind cluster; `help` lists its commands.

- Queue, ordering or dispatch changes (`parentDependency.ts`, `queueSort.ts`,
  `informer.ts`, `processItem*.ts`): generate CRs with
  `packages/operator/tools/dummies-ctl.cjs` and `apply` the printed directory.
- Retry or policy changes (`retry*.ts`, `policies.ts`, `definitions.ts`): use
  `packages/operator/tools/tf-dummies-ctl.cjs`, then check `/tmp/retries` and
  each TFResult's `exitCode` and `retryCount`. Finish with `tf-cleanup`.
- Run both start orders: operator first, then CRs; CRs first, then operator.
  Start with 3–5 CRs and never go past 20 unless asked.
- Every CR must be created, updated and deleted cleanly: expected status
  reached, no stuck finalizers, no error spikes in `logs`, and a sane
  `/tmp/queue` and `/tmp/diagnostic` in the pod (read them with `exec`).
- Don't edit files or run `down` while validating.

## Issues and skills

- Issues live in GitHub Issues on `firestartr-pro/firestartr` (use `gh`).
  Labels: `docs/agents/triage-labels.md`.
- Workflow skills (grilling, tdd, implement, …) come from
  [`prefapp/skills`](https://github.com/prefapp/skills). Repo skills live in
  `.agents/skills/`.

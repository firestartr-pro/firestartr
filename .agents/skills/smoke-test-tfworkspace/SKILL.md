---
name: smoke-test-tfworkspace
description: Run live smoke tests of TFWorkspace claims on a pre-environment org with smoke-tests/scripts/smoke.sh.
disable-model-invocation: true
---

# smoke-test-tfworkspace

> **Blocked** until [prefapp/features#1104](https://github.com/prefapp/features/issues/1104)
> is fixed; until then, results are wrong.

Follow the rules and lifecycle of the `smoke-test-renderer` skill (same script,
org checks, approvals, `ia-test` annotation, no commits here). Run workflows
one at a time. TFWorkspace specifics:

- **Flat claims.** `kind` and `name` at the top level, like
  `base_claims/tfworkspaces/tfworkspace_a.yaml`; Kubernetes-style
  `apiVersion`/`metadata`/`spec` fails to load.
- **Use `source: Inline`**, where `module` is raw HCL, to avoid depending on a
  module registry.
- **Set `providers.terraform.policy: full-control`.** The default `apply`
  blocks destroy with `POLICY CONFLICT`.
- **Ask for the provider config and backend names.** They are usually
  `github-<org>` and `tfstate-<org>`, but never guess; a wrong name fails with
  `providerconfigs/<name>: Not Found`.
- **Create:** copy the fixture into `.tmp_dir/orgs/<org>/claims/.skel/`, then
  `create .skel/base.yaml claims/tfworkspaces/<name>.yaml <json-patches>` to set
  `/name`, `/providers/terraform/name` and the two context names.
- **Verify:** `hydrate <name> TFWorkspaceClaim`, `summary`, then `check` (ask
  first; some orgs can't plan). Show the plan before offering `merge`.
- **Teardown:** `delete-tfworkspace <name>` opens a CR deletion PR
  (`state-infra`, runs destroy) and a claim deletion PR (`claims`). Both must
  merge before `cleanup`. Its merges always prompt, even with `--yes`
  (`printf 'y\ny\ny\n' | …` in non-interactive runs).
- There's no `exec`; use `kubectl` directly.

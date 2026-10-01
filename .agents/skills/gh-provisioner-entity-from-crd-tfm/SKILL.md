---
name: gh-provisioner-entity-from-crd-tfm
description: Create the smallest compliant packages/gh_provisioner entity that maps a CRD spec to a Terraform module's variable "config" object.
---

# gh-provisioner-entity-from-crd-tfm

## Feasibility gate
- Possible only if the CRD exists and the TFM has `variable "config"`.
- Reject if the TFM lacks `variable "config"`; do not write entity code.
- Reject or ask if any required TFM config key has no CRD source/default.
- Default to the issue's limited output: only work in `packages/gh_provisioner/src/entities/<entity>/`.
- Expand to factory registration, default TFM config, tests, or fixtures only when the user explicitly opts in; state that package rules require those for a production-ready CR kind.
- Helpers or complex post-provision code are allowed only when the user explicitly requests them. Otherwise keep everything in `src/entities/<entity>/index.ts` and make `postProvision` a no-op.

Before any code, check the target CRD in `packages/k8s/src/crds/` and the
Terraform module at the exact ref (record the full commit SHA for
`prefapp/tfm`). Use the `gh-provisioner-tfm-compatibility` skill.

- No `variable "config"` in the module: reject.
- A required config key with no CRD source or default: stop and ask.
- Dynamic or uncertain paths: stop and ask; don't guess.

## Scope

By default, touch only `src/entities/<entity>/index.ts`, starting from
[`entity.template.ts`](entity.template.ts). Registering the kind in
`src/entities/index.ts`, pinning the module (full commit SHA) in
`src/terraform.ts`, and tests and fixtures in `__tests__/` are needed for a
production-ready kind: do them when asked, and say so otherwise.

## Mapping

- Map into `document.config` only the keys the module reads: `variable
  "config"` plus every `var.config.*`, `lookup(var.config, …)` and
  `try(var.config.*)`.
- Don't copy Firestartr infrastructure fields (`org`, `context`, `firestartr`,
  `writeConnectionSecretToRef`) unless the module expects them.
- Keep the CRD/module camelCase names. Omit absent optional fields so the
  module's defaults apply.
- Keep transformations inline in the entity. `postProvision` is a no-op unless
  the task requires side effects.

## Report

Feasibility verdict and module ref, files changed, incompatible and ignored
variables, dynamic paths, and the validation results.

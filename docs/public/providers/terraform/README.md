# Terraform Provider Documentation

This section documents the Firestartr Terraform provider. It turns a
`TFWorkspaceClaim` into an OpenTofu workspace that is planned, applied, and
reconciled by the Firestartr controller.

## OpenTofu under the hood

The provider is called **terraform** and the claim key is **always**
`providers.terraform`. The runtime executes [OpenTofu](https://opentofu.org/)
(the `tofu` binary), not HashiCorp Terraform. Modules, providers, backends, and
state are OpenTofu-compatible. Where this documentation says "Terraform
workspace", it means the claim and custom-resource concepts; where it says
"OpenTofu", the runtime binary is relevant.

## What a claim produces

| Claim | Rendered resources |
| --- | --- |
| `TFWorkspaceClaim` | `firestartr.dev/v1` `FirestartrTerraformWorkspace`, and (when catalog output is enabled) a Backstage `Resource`. |

A `TFWorkspaceClaim` is **not** converted into a HashiCorp provider plugin
configuration. It is a declarative request that the controller materializes with
OpenTofu.

## Minimal example

```yaml
kind: TFWorkspaceClaim
name: example-workspace
version: "1.0"
lifecycle: production
owner: "group:firestartr-team"
system: "system:firestartr-system"
resourceType: tfresource
providers:
  terraform:
    name: example-workspace
    policy: apply
    source: Inline
    module: |
      output "example" {
        value = "Hello World"
      }
    values: {}
    context:
      providers:
        - name: provider-aws-workspaces
      backend:
        name: firestartr-terraform-state
```

## Claim fields

The claim envelope is shared by all claims: `name`, `kind`, `description`,
`type`, `lifecycle`, `version`, `profile`, and `annotations`. A
`TFWorkspaceClaim` additionally requires `owner` and accepts the optional
`resourceType` and `system` fields.

The `providers.terraform` block supports:

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Logical workspace name. |
| `source` | Yes | `Inline` or `Remote` (lowercase `inline`/`remote` are also accepted and normalized). |
| `values` | Yes | Arbitrary object of module inputs, written as `terraform.tfvars.json`. |
| `context` | Yes | Provider and backend references (see below). |
| `module` | For `Remote` | Module source for `Remote`; for `Inline` it is optional inline HCL. In practice `Remote` needs it. |
| `policy` | No | General operation policy. Defaults to `observe`. See [Workspace Policies](./workspace-policies.md). |
| `tfStateKey` | No | Explicit UUID state key. Generated and preserved when omitted. |
| `files` | No | Additional files to write into the workspace, each with `source` and `destination`. |
| `valuesSchema` | No | Schema locator. **Not currently enforced** — see Operational notes. |
| `sync` | No | Synchronization schedule and policy. See [Workspace Sync](./workspace-sync.md). |
| `variants` | No | Derived workspaces. See [Variants](./variants.md). |

> **Note:** the claim schema does not require `module` or `context.backend`, but
> remote execution and the operator both expect them. Declare both to avoid a
> workspace that renders but fails at reconciliation.

## Sources

### Inline

With `source: Inline` and no `module`, every `.tf` file under the claim
directory is read, sorted by path, and concatenated into the workspace. The
combined module content must be non-empty and shorter than 750,000 characters.

```yaml
providers:
  terraform:
    source: Inline
    module: |
      resource "null_resource" "example" {}
```

### Remote

With `source: Remote`, `module` must point at a module source (for example a
`git::https://…` URL). The controller initializes the project from that module.

```yaml
providers:
  terraform:
    source: Remote
    module: git::https://github.com/prefapp/tfm.git//modules/aws-s3-bucket?ref=<commit>
```

The operator warms a local mirror of `https://github.com/prefapp/tfm` at startup
and refreshes it periodically to speed up remote initialization. It exits if the
warmup fails unless `TFM_MIRROR_DISABLE=1` is set.

## Provider and backend references

The workspace `context` names `FirestartrProviderConfig` resources rather than
embedding credentials:

```yaml
providers:
  terraform:
    context:
      providers:
        - name: aws-foo           # -> FirestartrProviderConfig/aws-foo
      backend:
        name: tfstate-foo         # -> FirestartrProviderConfig/tfstate-foo
```

Each reference becomes an explicit `FirestartrProviderConfig` reference on the
rendered workspace. The config object is namespaced (`firestartr.dev/v1`,
short name `prvcfg`) and carries the credential material:

| Field | Required | Description |
| --- | --- | --- |
| `type` | Yes | Provider local name, or backend selector. |
| `source` | Yes | Terraform required-provider source. Ignored for backends. |
| `version` | Yes | Provider version constraint. Ignored for backends. |
| `config` | Yes | **JSON text.** Provider or backend configuration. |
| `inline` | No | Literal HCL used instead of the JSON `config` when set. Applies to provider configs only; it is ignored for backends. |
| `env` | No | JSON text of environment-style secrets. Parsed, but not merged into the spawned process environment. |
| `secrets` | No | Map of interpolation names to `secretRef.{name,namespace,key}`. |

`${{ secrets.NAME }}` placeholders in `config` and `inline` are replaced with
the referenced Kubernetes Secret values. A backend is rendered for exactly three
types:

| `type` | OpenTofu backend | Notes |
| --- | --- | --- |
| `aws` | `s3` | Config keys are stringified; the state key becomes the S3 `key`. |
| `kubernetes` | `kubernetes` | Most config is ignored; `in_cluster_config = true` is hard-coded and `secret_suffix` is derived from the state key. Only `config.namespace` is used. |
| `azurerm` | `azurerm` | Config keys are stringified; the state key becomes `key`. |

Any other backend `type` fails during reconciliation (the provisioner writer
throws `Backend type ... not supported`). Provider plugin handling is
generic: any OpenTofu-compatible provider source/version/config is accepted.

## References between workspaces

A workspace can consume another workspace's outputs:

```yaml
${{ tfworkspace:<claim-name>:outputs.<output-key> }}
```

The `tfworkspace`/`outputs` keywords are matched case-insensitively, but the
captured claim name is resolved exactly as written — use the target claim's own
casing or the reference does not resolve. Rendering resolves the target to its
concrete workspace CR and records a `spec.references[]` entry. References to
external secrets become `ExternalSecret` refs, and direct secret references
become `Secret` refs.

## Rendered names and state keys

Each workspace gets a stable UUID `tfStateKey`. When a claim does not set one, a
UUID is generated and then preserved across renders. The **Kubernetes resource
name** is the normalized workspace name with the state key appended:

```text
<normalized providers.terraform.name>-<tfStateKey>
```

The logical/claim name is unaffected, and references use the logical name. Do
not assume the Kubernetes object name equals the claim name.

Two workspaces may not share the same `tfStateKey`; rendering rejects duplicates.

## Outputs

After a successful `apply`, the controller writes the OpenTofu outputs to a
Secret named `<lower-cased CR kind>-<workspace CR name>-outputs` in the workspace
namespace, owned by the workspace CR. Outputs are stored as a base64-encoded JSON
blob under the `outputs` key.

`TFResult` (`firestartr.dev/v1`, short name `tfresult`) records command output
and the exit code. `FirestartrTerraformWorkspace` and
`FirestartrTerraformWorkspacePlan` both expose `/status`.

> **Output behavior:** the CRDs expose `spec.writeConnectionSecretToRef`, but the
> workspace flow does not honor a custom name or output list. Outputs always land
> in the derived Secret described above.

## Additional files

`files[]` entries are read relative to the claim directory and written into the
generated workspace at their `destination`. Content is stored base64-encoded on
the CR and decoded by the provisioner, which rejects destinations that escape the
workspace directory.

## Lifecycle

The controller reconciles created, updated, renamed, sync, retry, and
deletion-marked events according to the general policy, and a deletion-marked
workspace runs `tofu destroy`. See [Workspace Policies](./workspace-policies.md)
for the operation matrix and [Workspace Sync](./workspace-sync.md) for scheduled
reconciliation.

## Operational notes

- **OpenTofu, not Terraform.** Only the `tofu` binary is executed.
- **`source: Remote` still needs a module.** A claim without `module` renders but
  `Remote` cannot initialize.
- **`valuesSchema` is inert.** The optional validator is registered for the
  wrong kind, so values are not validated against it in the production path.
- **UUIDs in CR names.** Workspace CR names include the state key suffix.
- **Raw CRs can be looser than the claim schema.** A hand-written
  `FirestartrTerraformWorkspace` can pass Kubernetes admission and still fail in
  reconciliation if `values`, `context`, or references are missing.
- **A separate plan kind exists.** `FirestartrTerraformWorkspacePlan`
  (`tfwpl`) mirrors the workspace spec without `files`, uses its own legacy
  processor, and recognizes only the `observe`, `apply`, and `destroy` policy
  values.

## Features

- [TFWorkspaceClaim Variants](./variants.md) — derived Terraform workspaces for disaster recovery and multi-region deployments.
- [Terraform Workspace Policies](./workspace-policies.md) — the operation security gate for workspaces.
- [Terraform Workspace Sync](./workspace-sync.md) — scheduled drift detection and reconciliation.

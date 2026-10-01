# TFWorkspaceClaim Variants

## What is a variant?

A **variant** is a Terraform workspace derived from a parent TFWorkspaceClaim
that inherits all of the parent's configuration but applies targeted differences.
The parent claim remains the single source of truth; each variant is a full
workspace with its own lifecycle, state, and identity.

Variants are for **nearly identical workspaces that should evolve together**. The
canonical example is a **disaster recovery** resource — same configuration as the
primary, small per-environment differences.

For example, a parent workspace `s3-demo-staging` with a variant `dr` produces
**two** independent workspaces: the parent (`s3-demo-staging`) and the disaster
recovery copy (`s3-demo-staging-dr`).

## Simple example

Given an org named `foo` with a Terraform workspace `s3-bucket` in staging,
you can create a disaster recovery variant for the `us-west-1` region:

```yaml
kind: TFWorkspaceClaim
lifecycle: staging
name: s3-bucket
owner: "group:foo"
system: "system:foo"
version: "1.0"
providers:
  terraform:
    name: s3-bucket
    policy: full-control
    source: Inline
    values:
      bucket_name: foo-staging-data
      environment: staging
      region: eu-west-1
    context:
      providers:
        - name: aws-foo-eu
      backend:
        name: tfstate-foo-staging
    variants:
      - name: dr-us
        overrides:
          values:
            bucket_name: foo-staging-data-dr
            environment: staging-dr
            region: us-west-1
          context:
            providers:
              - name: aws-foo-us
```

This produces **two** logical workspaces:
- `s3-bucket` — the original parent
- `s3-bucket-dr-us` — the variant for us-west-1

> **Note — CR names carry a UUID.** The *logical* names above (used by claims,
> catalog entities, references, and the variant's `firestartr.dev/variant-of`
> annotation) are `s3-bucket` and `s3-bucket-dr-us`. The actual Kubernetes
> `FirestartrTerraformWorkspace` names append the workspace's state UUID, for
> example `s3-bucket-a1850b50-677d-4a81-92a4-1318503b5568`. Use the logical
> name everywhere except when inspecting Kubernetes objects directly.

## How to use variants

### Declare a variant

Add a `variants` array under `providers.terraform` in any TFWorkspaceClaim. Each
variant entry needs:

| Field | Description |
| --- | --- |
| `name` | Short suffix combined with the parent's terraform name to form the composed name. |
| `overrides` | Fields to change from the parent. Everything else is inherited. |

### What you can override

| Allowed | Prohibited |
| --- | --- |
| `values` | `source` |
| `context` | `module` |
| `policy` | `name` |
| `sync` | |
| `tfStateKey` | |
| `files` | |
| `valuesSchema` | |

`source`, `module`, and `name` are prohibited because they would change
fundamental provisioning semantics. The composed name is always derived and
cannot be overridden.

Overrides use **deep merge**: change a single key inside `values` or a single tag
without re-declaring everything else.

> **Merge behavior — leaf merge, not block replacement.** Nested blocks,
> including `sync`, are merged key by key, so you do **not** need to re-declare
> the whole block. Arrays are merged by index, so an override list replaces
> entries positionally rather than wholesale — a shorter list does not remove
> trailing parent entries. Prefer overriding whole scalar values or re-declaring
> complete arrays with every element you want.

> **Validation — structural checks are not enforced at load time.** The schema
> describes a maximum variant-name length and rejects unknown/nested override
> fields, but the production loader removes the `variants` block before schema
> validation and does not re-validate synthesized variants. Only `name` and
> `overrides` being present is enforced, plus the explicit `source`/`module`/
> `name` prohibition. Keep variant names short and override fields to the table
> above by convention.

### Parent and variant lifecycle

- The parent continues to exist as a **real workspace** alongside its variants.
  It is not converted into a template.
- Deleting the parent claim file **deletes all its variants**.
- Each variant has its own state (`tfStateKey`), policy, and sync schedule.
- Changes to the parent (source, module, values) **propagate to all variants**
  unless a variant explicitly overrides that field.

### Reference a variant from another workspace

Other TFWorkspaceClaims can reference a variant's outputs using the **composed
name** in the standard reference syntax:

```yaml
${{ tfworkspace:<composed-name>:outputs.<key> }}
```

For example, to reference the `s3-bucket-dr-us` variant's bucket ARN from
another workspace:

```yaml
kind: TFWorkspaceClaim
name: data-processor
providers:
  terraform:
    name: data-processor
    source: Inline
    values:
      source_bucket: ${{ tfworkspace:s3-bucket-dr-us:outputs.bucket_arn }}
      source_region: us-west-1
```

The parent and each variant are **independently referenceable** — you can target
the parent (`s3-bucket`) or any variant separately.

## Limitations

- No nested variants — a variant cannot itself declare variants.
- Parent changes propagate to all variants — no per-variant opt-out.
- Override arrays merge by index; there is no "remove an element" semantics.
- Migrating a variant to a standalone claim is a manual process.

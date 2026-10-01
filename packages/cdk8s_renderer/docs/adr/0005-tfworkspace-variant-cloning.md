# TFWorkspaceClaim variant cloning

## Motivation

Variants maintain multiple Terraform workspaces from a single base template with
small per-instance differences. They are for TFWorkspaces that are nearly
identical and should evolve together — a disaster recovery copy of a workspace
is the canonical example.

Without variants, a user would need to maintain separate TFWorkspaceClaims that
must be kept in sync manually. Variants codify the relationship: the parent is
the source of truth, and each variant inherits its base configuration from the
parent while adding targeted overrides.

We chose the term **variants** (over "clones") because "variant" communicates a
curated alternative rather than an identical copy.

## Decision: inline declaration in the parent claim

Variants are declared inline in the parent TFWorkspaceClaim under
`providers.terraform.variants`. The `variants` array is the **only** declaration
point — no separate claim file, claims-map entry, or feature flag is needed.

The parent TFWorkspaceClaim **continues to produce its own CR independently**
of the variants. It is not a template-only claim — it is a full workspace that
exists alongside its variants.

## Decision: loader-phase synthetic claim construction

Variants are constructed in the **loader** phase (`src/loader/lazy_loader.ts`).
After a claim file is loaded and parsed, the loader:

1. Strips `providers.terraform.variants` from the parent claim
2. Validates the parent claim without the variants array
3. For each variant entry, creates a **synthetic claim** — a deep clone of the
   parent with overrides deep-merged into the terraform provider block

These synthetic claims then flow through the **entire pipeline** — sorting,
patching (initializers, normalizers, overriders, globals), chart rendering, and
validations — identically to any loaded claim. Their `claimPath` points to the
parent's original file so that edit-url and claim-ref annotations resolve
correctly.

## Decision: lodash.merge for deep-merging overrides

Variant overrides are deep-merged into the parent's terraform provider block
using `lodash.merge` (leaf-level merging). A variant can override a single key
inside `values.tags` or `context` without re-declaring the rest.

Some object blocks (e.g., `sync`) may require full re-declaration in the
override — leaf merging does not apply uniformly to every nested shape.

## Decision: prohibited override fields

Three fields are prohibited in variant overrides (`lazy_loader.ts:201`):

| Field | Reason |
|---|---|
| `source` | Would change fundamental provisioning semantics (Inline vs remote) |
| `module` | Would point to an entirely different Terraform module |
| `name` | Always the composed name (see Naming convention) |

A variant can override: `values`, `context`, `files`, `policy`, `sync`,
`tfStateKey`, and `valuesSchema`.

## Decision: schema-enforced structural constraints

The override schema (`TerraformProviderVariantOverride`) has
`additionalProperties: false` — unknown override fields are rejected at
validation time.

The variant entry schema (`TerraformProviderVariant`) has `additionalProperties:
false` with only `name` and `overrides` — **nested variants are structurally
impossible**.

## Decision: composed naming convention

The variant `name` field is a **shorthand suffix** — max 10 characters, enforced
via AJV `maxLength`. The composed name is:

```
composed-name = {main's terraform provider name}-{variant-name}
```

The `overrides.name` field is **not permitted** in variant overrides — the
composed name is always authoritative.

The composed name becomes: `claim.name`, `providers.terraform.name` (the CR
name), the claim ref (`TFWorkspaceClaim-<composed-name>`), and the catalog
Resource entity name.

## Decision: .variant.yaml output file suffix

Variant CRs are written to the output directory with a `.variant.yaml` suffix
instead of the normal `.yaml` suffix. The hydrate workflow **relies** on this
suffix to identify variant CRs — it is not cosmetic.

## Decision: dual-path previous CR matching

Variant CRs are matched against previously rendered output using a dual-path
strategy in `src/renderer/previous-crs-extractor.ts`:

1. **Primary**: match `claim-ref` annotation against `claim.kind/claim.name`
   (the composed name)
2. **Fallback**: match `claim-ref` against `claim.kind/_parentClaimName` (the
   original parent name) combined with the CR name prefix

The fallback exists because variant CRs carry the parent's `claim-ref`
annotation rather than a variant-specific one. This ensures variant CR identity
is preserved across re-renders.

## Decision: variant annotations

Variant CRs carry two annotations on the rendered Kubernetes object:

| Annotation | Value | Purpose |
|---|---|---|
| `firestartr.dev/variant-of` | parent CR name | Links this CR to its parent |
| `firestartr.dev/claim-ref` | `TFWorkspaceClaim/<parent-claim-name>` | Points to the parent claim file (inherited) |

## Decision: variant CRs are independent resources

Each variant produces its own `FirestartrTerraformWorkspace` CR with its own
UUID-backed tfStateKey, sync schedule, policy, and Backstage catalog entity.
Each is reconciled independently by the operator.

## Consequences

### Parent deletion cascades to variants

Because variants are synthetic claims derived from the parent claim file,
**deleting the parent claim deletes the variants too**. Variants cannot outlive
their parent.

### Parent changes propagate to all variants

The loader always re-synthesizes variants from the parent's current state.
Changes to the parent (including `source` and `module`) **propagate to all
variants** unless explicitly overridden. There is no per-variant opt-out from
parent configuration changes.

### Name collision detection at load time

Variant names combined with the parent's terraform provider name produce the
composed claim ref. Collision detection (`lazy_loader.ts:233-237`) runs at
load time and fails fast when:

- The same parent declares two variants with the same `name`
- Two different parents share the same terraform provider name and both declare
  a variant with the same suffix

There is no explicit limit on the number of variants per parent.

### Architecture boundary: no nested variants

The schema prevents a variant from declaring its own `variants` array. This is
an intentional structural constraint, not a missing feature.

### No current catalog relationship between parent and variant entities

Parent and variant catalog entities are currently independent — no `dependsOn`
or `variantOf` edge is rendered. This may be addressed in a future PR.

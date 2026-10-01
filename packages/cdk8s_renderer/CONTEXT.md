# cdk8s_renderer

Renders Firestartr Claims into Kubernetes CRs and Backstage catalog entities
through a chart + patch pipeline. This glossary covers the rendering pipeline;
other areas are authored lazily via `/domain-modeling` as the package is touched.

## Language

**Claim**:
A user-authored input document the renderer consumes (`ComponentClaim`,
`GroupClaim`, …).
_Avoid_: spec, manifest, input

**Chart**:
A cdk8s chart that renders a Claim into Firestartr CR(s).
_Avoid_: template, generator

**Patch pipeline**:
The ordered passes (initializers, normalizers, overriders, globals, defaults)
applied to rendered CRs.
_Avoid_: post-processing, hooks

**Catalog entity**:
A rendered Backstage entity (Component, Group, User, System, Domain, API,
Resource).
_Avoid_: backstage object

**Reference resolution**:
Resolving cross-references between Claims into concrete values.
_Avoid_: linking, lookup

**Client**:
A real customer of Firestartr. The operator is deployed one-per-client in the
client's own Kubernetes namespace, so a client maps 1:1 to a claims repository.
_Avoid_: tenant, customer org

**Render pass**:
One invocation of the renderer over a single client's claims repository.
Because the operator is namespace-per-client, the rendered CR set is always
exactly one client's data — never mixed across clients.
_Avoid_: render run, batch

**Actions variables**:
A list of GitHub Actions organization-level variables declared under
`providers.github.actions_variables` in an `OrgSettingsClaim`. Each entry has a
`name`, `value`, `visibility` (`all`, `private`, or `selected`), and optional
`selected_repositories` (list of `component:<name>` refs). The chart resolves
component refs to `org/repo` full names at render time and produces a
`FirestartrGithubOrganizationVariableSection` CR — at most one per org per
render pass.
_Avoid_: org variables, github variables, env vars

**Org-settings singleton**:
The render-time rule that at most one `FirestartrGithubOrganizationSettings`
may exist per GitHub org (`spec.org`, case-insensitive) within a render pass.
A client may manage many GitHub orgs (many settings CRs), but only one
settings CR per org. Scope is the whole rendered set, which equals one client.
_Avoid_: unique constraint, dedup

**Edit URL (Backstage)**:
A `backstage.io/edit-url` annotation on a catalog entity that points to the
source claim file in the git repository, enabling Backstage's "edit" button
to navigate to the source of truth instead of the (non-editable) catalog view.
The URL is a full git URL constructed at render time from the repository base
URL, default branch, and the claim's path relative to the **repository root**
(not the claims subdirectory). Since the `--claims` CLI flag points to the
`claims/` subdirectory, the renderer uses the parent of that path as the base,
preserving the `claims/` prefix in the URL path segment (e.g.
`claims/groups/grupo-c.yaml`). When the repository URL is not explicitly
configured, the renderer derives it as `https://github.com/{ORG}/claims` from
the `ORG` environment variable.
_Avoid_: backstage link, source link

**Embedded entity**:
A catalog entity that is rendered as a side-effect of processing a different
claim kind, without its own standalone claim file. Currently applies only to
API entities, which are derived from `ComponentClaim.providesApis`. Because
they have no claim file of their own, their edit URL points to the parent
Component's claim file.
_Avoid_: child entity, derived entity

**Variant**:
A cloned CR produced from a single parent claim's `providers.terraform.variants`
block. Each variant is a full clone of the parent's terraform provider config
with selective overrides, rendered through the entire pipeline as an independent
CR with its own UUID, tfState, and catalog entity.
_Avoid_: clone, child CR, derived CR

**Claim stitching**:
The pre-render phase (`defaults → feature claim-patches → AJV`) that assembles the stitched claim before rendering. Distinct from the post-render patch pipeline. Runs in `loadClaim` and at the import boundary (`renderFromImports`), where stitching is once-only for already-stitched claims.
_Avoid_: feature patching, claim patching, stitching pipeline

**Stitched claim**:
The fully-assembled, validated claim produced by claim stitching and handed to the render phase as its sole input. Once stamped with the `STITCHED_CLAIM` symbol it is never re-stitched, only re-validated.
_Avoid_: stitched input, final claim, rendered claim

**Protected claim path**:
A platform-curated JSON Pointer a feature claim-patch is forbidden to write to (e.g. `/kind`, `/name`, `/providers/github/org`). The stitching engine rejects any feature patch targeting a protected path before AJV.
_Avoid_: protected field, blocked path

**Write region**:
The set of claim-tree nodes a feature patch writes, used as the conflict key. A whole-pointer write covers the pointer and every descendant; an array append carrying a `name` writes the pointer plus that element's name. Two features writing overlapping regions (one a prefix of the other, or equal) fail closed as `duplicate-path` in either order; the only carve-out is distinct-name array appends, whose write regions never overlap. JSON-Pointer escaping is decoded before comparison.
_Avoid_: destination, target path, conflict key

**Overwrite protection**:
The stitching guarantee that governs conflicts between a feature claim-patch and a value already declared by the user or by `claims_defaults.yaml`. The raw claim is retained as the source of truth for what the user declared. For array appends (`add ... /-`, e.g. labels), the declared array value wins and the feature patch is silently dropped. For non-array paths the user declared in the raw claim, the feature patch cannot write: the stitching engine rejects it with `user-declared-path`. A feature patch may only overwrite a non-array value that exists solely via `claims_defaults.yaml` (absent from the raw claim), and then the patch wins. A `replace`/`remove` targeting an absent path is rejected.
_Avoid_: overwrite guard, user-intent protection

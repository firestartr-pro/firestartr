# Catalog Provider (implicit)

The `catalog` provider is **implicit**: you never declare a `providers.catalog`
block. Whenever catalog output is enabled, every claim that has a catalog mapping
is projected into a [Backstage](https://backstage.io/) catalog entity as part of
normal rendering. The entity is derived from the claim itself — its kind, name,
`owner`, `system`, `profile`, and other fields. `OrgSettingsClaim` is the
exception: it renders only GitHub CRs and no catalog entity.

Catalog output is produced in the `catalog` and `all` renderer modes. There is no
default renderer mode: you must select at least one provider (`--provider`, or
`--all-providers` for `all`). When `all` is selected, catalog output is included
alongside the provider's managed resources.

## Claim-to-entity mapping

| Claim kind | Entity kind | Notable `spec` fields |
| --- | --- | --- |
| `DomainClaim` | `Domain` | `owner` |
| `SystemClaim` | `System` | `owner`, `domain` |
| `GroupClaim` | `Group` | `type`, `profile`, `parent`, `children`, `members` |
| `UserClaim` | `User` | `profile`, `memberOf`; an admin GitHub role adds the `firestartr.backstage.dev/org-role: owner` annotation |
| `ComponentClaim` | `Component` | `type`, `lifecycle`, `owner`, `system`, `subComponentOf`, `providesApis`, `consumesApis` |
| `ComponentClaim` + `providesApis` | `API` (one per entry) | `type`, `lifecycle`, `owner`, `system`, definition URL |
| `TFWorkspaceClaim` | `Resource` | `type` (`resourceType` or `tfresource`), `owner`, `system`, `values`, `dependsOn` |
| `SecretsClaim` | `Resource` | `type: secret-set`, `owner`, `system`, `secrets` |
| `ArgoDeployClaim` | `Resource` | `type` (`type` or `argodeploy`) |
| `OrgWebhookClaim` | `Resource` | `type: webhook`, `owner`, `system` |

All entities use `apiVersion: backstage.io/v1alpha1`. Annotations on the claim
are copied onto the entity. `OrgSettingsClaim` does **not** produce a catalog
entity.

## Examples

A component and its API:

```yaml
kind: ComponentClaim
name: component_a
type: service
lifecycle: production
system: "system:system_a"
owner: "group:group_a"
providesApis:
  - name: component-a-api
    type: openapi
    definitionfile: api/openapi.yaml
providers:
  github:
    org: firestartr-test
    name: component_a
    visibility: private
    branchStrategy:
      name: main
```

A Terraform workspace becomes a `Resource` whose `dependsOn` lists references
found in its values:

```yaml
kind: TFWorkspaceClaim
name: data-processor
resourceType: tfresource
owner: "group:firestartr-team"
system: "system:firestartr-system"
providers:
  terraform:
    name: data-processor
    source: Inline
    values:
      source_bucket: ${{ tfworkspace:s3-bucket:outputs.bucket_arn }}
```

The rendered `Resource` gets `dependsOn: ["resource:s3-bucket"]`.

## What it needs

- A `name` (present on every claim).
- `owner` where the entity spec requires it; components default a missing owner
  to `nobody`, and webhook resources do the same.
- `system` / `domain` references where applicable.
- For `ComponentClaim` APIs, a resolvable GitHub `org` and repository `name`,
  plus a default branch (from an optional `branchStrategy.defaultBranch`,
  falling back to `main`), to build the definition URL.

## Notes

- **No configuration block.** `providers.catalog` is not read. Where a claim
  schema exposes it (for example `DomainClaim`/`SystemClaim`), it is not consumed
  by the catalog charts.
- **Entity names.** Most entities use the claim name directly. Resource entities
  for secrets and webhooks use a prefixed, normalized name
  (`secrets-<claim>` / `orgwebhook-<claim>`), and Terraform workspaces use the
  normalized claim name with the claim name as the entity `title`.
- **Automatic for every mapped claim.** There is no per-claim opt-in or opt-out
  at the claim level; catalog generation is controlled by the renderer mode.

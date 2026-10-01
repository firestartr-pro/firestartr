# GitHub Provider

The `github` provider manages your GitHub organization declaratively. It renders
GitHub claims into `firestartr.dev/v1` custom resources, and the GitHub
provisioner reconciles them through pinned OpenTofu modules from
[`prefapp/tfm`](https://github.com/prefapp/tfm).

## Claim kinds and managed resources

| Claim kind | Populated by | Rendered CR kind | Provisions |
| --- | --- | --- | --- |
| `GroupClaim` | top-level `members`, `parent` | `FirestartrGithubGroup` | A GitHub team and its direct members. |
| `UserClaim` | — | `FirestartrGithubMembership` | Organization membership and the mandatory `<org>-all` team membership. |
| `ComponentClaim` | `providers.github` | `FirestartrGithubRepository` | A repository, settings, files, permissions, labels, topics, variables, and secrets. |
| `ComponentClaim` | `providers.github.features` | `FirestartrGithubRepositoryFeature` | A versioned set of repository files. |
| `ComponentClaim` | `providers.github.secrets` | `FirestartrGithubRepositorySecretsSection` | Actions, Codespaces, and Dependabot repository secrets. |
| `OrgSettingsClaim` | `providers.github` | `FirestartrGithubOrganizationSettings` | Organization settings. |
| `OrgSettingsClaim` | `providers.github.actions_variables` | `FirestartrGithubOrganizationVariableSection` | Organization Actions variables. |
| `OrgWebhookClaim` | `providers.github` | `FirestartrGithubOrgWebhook` | An organization webhook. |

The renderer picks the CR by the claim kind; the provisioner picks a pinned
OpenTofu module by the CR kind. Each CR can override its module with the
`firestartr.dev/terraform-module` annotation.

## Default modules

All modules are `git::https://github.com/prefapp/tfm.git//modules/...` at pinned
commits:

| CR kind | Module |
| --- | --- |
| `FirestartrGithubGroup` | `github-team` |
| `FirestartrGithubMembership` | `github-membership` |
| `FirestartrGithubRepository` | `github-repo` |
| `FirestartrGithubRepositoryFeature` | `github-files-set` |
| `FirestartrGithubRepositorySecretsSection` | `github-repo-secrets-section` |
| `FirestartrGithubOrganizationSettings` | `github-org-settings` |
| `FirestartrGithubOrganizationVariableSection` | `github-org-variables-section` |
| `FirestartrGithubOrgWebhook` | `github-org-webhook` |

## Shared conventions

### Provider and backend references

Every rendered GitHub CR carries execution plumbing that is not part of the
claim fields:

```yaml
spec:
  context:
    provider:
      ref:
        kind: FirestartrProviderConfig
        name: github-app
    backend:
      ref:
        kind: FirestartrProviderConfig
        name: aws-state-bucket
  firestartr:
    tfStateKey: a1850b50-677d-4a81-92a4-1318503b5568
```

These come from the repository's default values (typically a GitHub provider
named `github-app` and a state backend named `aws-state-bucket` or
`firestartr-terraform-state`). The referenced GitHub provider is only the
**credential source**: it supplies the GitHub App credentials (and provider
secrets) the provisioner uses, never the target organization. Each entity
passes its CR's own `spec.org`/`spec.orgName` to the GitHub API, and that field
is what selects the organization per call — keep the claim organization fields
pointing at an organization where the app is installed.

### State keys

Each CR has a stable `spec.firestartr.tfStateKey`. When the claim omits it, a
UUID is generated and preserved across renders. Duplicate state keys across
rendered Terraform workspace CRs are rejected at render time.

### External name and import IDs

The provisioner uses the CR's **operational name**, which is:

- `metadata.annotations['firestartr.dev/external-name']` when present, otherwise
- `metadata.name`.

The optional `firestartr.dev/github-id` annotation supplies the numeric GitHub ID
used for Terraform imports. Together they let an existing GitHub object be
adopted instead of recreated:

```yaml
metadata:
  name: my-team
  annotations:
    firestartr.dev/external-name: 私のチーム   # actual GitHub team name
    firestartr.dev/github-id: "16210767"       # numeric team ID for import
```

### Import and post-provision

The provisioner supports explicit `import` and `import-with-reimport` operations,
and some entities adopt pre-existing objects automatically during `apply`. Import
coverage is entity-specific:

| Entity | Import behavior |
| --- | --- |
| Group | Team by ID, and each member by `<team-id>:<username>`. |
| Membership | Organization membership by `<org>:<username>`; the `<org>-all` team membership when it already exists. |
| Repository | Repository, default branch, OIDC template, declared branch protections, Actions variables, and Pages. Files, teams, and collaborators are **not** imported. |
| Repository labels | Adopted during `apply` when they already exist (and updated to match the claim). |
| Organization variables | Adopted during `apply` only; explicit import discovers nothing. |
| Organization webhook | Imported by matching webhook URL. |
| Repository secrets | No import/adoption. |
| Repository features | Special migration semantics for user-managed files. |

Some operations perform live GitHub API calls during resource loading (for
example the `<org>-all` team lookup for memberships and label adoption for
repositories).

## Claim reference syntax

Several fields reference other claims:

- Group members: `user:<name>` references (the `parent` and `children` relations
  use `group:<name>` references).
- Component secret values: `ref:secretsclaim:<secrets-claim-name>:<secret-key>`.
- Org webhook `secretRef`: `ref:secretsclaim:<secrets-claim-name>:<secret-key>`.
- Organization variable `selected_repositories`: `component:<name>`.

## Per-claim reference

- [GroupClaim](./group.md)
- [UserClaim](./user.md)
- [ComponentClaim](./component.md)
- [OrgSettingsClaim](./org-settings.md)
- [OrgWebhookClaim](./org-webhook.md)

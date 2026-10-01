# OrgSettingsClaim

An `OrgSettingsClaim` provisions GitHub organization settings and, optionally,
organization Actions variables. It renders two CRs: one for settings and one for
variables.

If you only need variables, omit the optional settings fields — `org` and
`billing_email` are still required. The settings CR and the variable-section CR
are derived from the same claim.

Rendered resources:

- `FirestartrGithubOrganizationSettings` — organization settings.
- `FirestartrGithubOrganizationVariableSection` — organization Actions variables.

Default modules: `github-org-settings`, `github-org-variables-section`.

## Example

```yaml
kind: OrgSettingsClaim
version: "1.0"
name: github_org_settings
providers:
  github:
    name: firestartr-test-org-settings
    org: firestartr-test
    billing_email: billing@example.com
    company: Prefapp
    blog: https://www.prefapp.es
    email: github-admins@example.com
    location: Vigo, ES
    description: Firestartr test GitHub organization
    default_repository_permission: read
    members_can_create_repositories: true
    members_can_create_private_repositories: true
    members_can_create_internal_repositories: true
    web_commit_signoff_required: true
    advanced_security_enabled_for_new_repositories: true
    dependabot_alerts_enabled_for_new_repositories: true
    secret_scanning_enabled_for_new_repositories: true
    actions_variables:
      - name: ORG_VAR_ALL
        value: all-value
        visibility: all
      - name: ORG_VAR_SELECTED
        value: selected-value
        visibility: selected
        selected_repositories:
          - component:component_a
```

## Fields

### `providers.github`

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Entity/workspace name (operational/external name). Not the GitHub org name. |
| `org` | Yes | GitHub organization to configure. |
| `tfStateKey` | No | Explicit UUID state key. |
| `billing_email` | Yes | Organization billing email. |
| `company`, `blog`, `email`, `twitter_username`, `location`, `description` | No | Organization profile fields. |
| `has_organization_projects`, `has_repository_projects` | No | Projects permissions. |
| `default_repository_permission` | No | `read`, `write`, `admin`, or `none`. |
| `members_can_create_*` | No | Repository/page creation controls. |
| `members_can_fork_private_repositories` | No | Fork permission. |
| `web_commit_signoff_required` | No | Require sign-off. |
| `advanced_security_enabled_for_new_repositories` and related Dependabot/secret-scanning flags | No | New-repository security defaults. |
| `actions_variables[]` | No | Organization Actions variables (below). |

### `actions_variables[]`

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Variable name (`^[A-Za-z0-9_]+$`). |
| `value` | Yes | Variable value. |
| `visibility` | Yes | `all`, `private`, or `selected`. |
| `selected_repositories` | For `selected` | `component:<name>` references. Resolved to `org/repo` strings. |

## Rendering

- `FirestartrGithubOrganizationSettings`: `metadata.name` is the normalized
  `providers.github.name` with the state key appended (`<name>-<tfStateKey>`);
  each settings field is copied into `spec` (camelCased). Fields not set on the
  claim are omitted.
- `FirestartrGithubOrganizationVariableSection`: `metadata.name` is the
  normalized `providers.github.name` with the state key appended
  (`<name>-<tfStateKey>`); `spec.actionsVariables` is an array of
  `{ name, value, visibility, selectedRepositories? }`. A `selected` variable's
  `selected_repositories` (claim) becomes `selectedRepositories` holding `org/repo`
  strings. The write connection Secret exposes `managed_variables` and
  `variable_ids`.

## Imports and adoption

- Organization settings: `github_organization_settings.this` with ID `spec.org`.
- Variables: **apply-time adoption only.** On `apply`, the entity reads its
  `managed_variables` self-output, checks each declared name against the GitHub
  API, and records existing ones for import. `401`/`403` and unexpected errors are
  skipped (logged), letting Terraform continue. An explicit `import` operation
  discovers nothing.

## Notes

- `spec.org` selects the organization; `providers.github.name` does not. Keep the
  referenced GitHub provider's owner aligned with `org`.
- The claim's `selected_repositories` entries are `component:<name>` references;
  the renderer resolves them to `org/repo` strings on the CR. The provisioner
  maps the CR array into a module object keyed by variable name and renames
  `selectedRepositories` to `selectedRepositoryIds`; no numeric-ID conversion is
  performed.

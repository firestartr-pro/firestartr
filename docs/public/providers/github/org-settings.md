# OrgSettingsClaim

An `OrgSettingsClaim` provisions GitHub organization settings and, optionally,
organization Actions variables and organization secrets. It renders three CRs:
one for settings, one for variables, and one for secrets.

`org` and `billing_email` are always required. The three CRs are derived from the
same claim and reconcile independently.

> **Warning:** the settings CR is always applied, even when you omit the optional
> settings fields. Omitted fields fall back to the `github-org-settings` module
> defaults (for example `default_repository_permission: read` and
> `members_can_create_repositories: true`), which can relax policies the
> organization currently enforces. When you add variables or secrets to an
> existing organization, set every settings field to its intended value
> explicitly.

Rendered resources:

- `FirestartrGithubOrganizationSettings` — organization settings.
- `FirestartrGithubOrganizationVariableSection` — organization Actions variables.
- `FirestartrGithubOrganizationSecretSection` — organization Actions, Codespaces
  and Dependabot secrets.

Default modules: `github-org-settings`, `github-org-variables-section`,
`github-org-secrets-section`.

## Example

```yaml
kind: OrgSettingsClaim
version: '1.0'
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
    org_secrets:
      actions:
        - name: ORG_SECRET_ALL
          value: ref:secretsclaim:platform_secrets:all_token
          visibility: all
        - name: ORG_SECRET_SELECTED
          value: ref:secretsclaim:platform_secrets:selected_token
          visibility: selected
          selected_repositories:
            - component:component_a
      codespaces:
        - name: ORG_CODESPACES_TOKEN
          value: ref:secretsclaim:platform_secrets:codespaces_token
      dependabot:
        - name: ORG_DEPENDABOT_TOKEN
          value: ref:secretsclaim:platform_secrets:dependabot_token
```

## Fields

### `providers.github`

| Field                                                                                         | Required | Description                                                                    |
| --------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `name`                                                                                        | Yes      | Entity/workspace name (operational/external name). Not the GitHub org name.    |
| `org`                                                                                         | Yes      | GitHub organization to configure.                                              |
| `tfStateKey`                                                                                  | No       | Explicit UUID state key.                                                       |
| `billing_email`                                                                               | Yes      | Organization billing email.                                                    |
| `company`, `blog`, `email`, `twitter_username`, `location`, `description`                     | No       | Organization profile fields.                                                   |
| `has_organization_projects`, `has_repository_projects`                                        | No       | Projects permissions.                                                          |
| `default_repository_permission`                                                               | No       | `read`, `write`, `admin`, or `none`.                                           |
| `members_can_create_*`                                                                        | No       | Repository/page creation controls.                                             |
| `members_can_fork_private_repositories`                                                       | No       | Fork permission.                                                               |
| `web_commit_signoff_required`                                                                 | No       | Require sign-off.                                                              |
| `advanced_security_enabled_for_new_repositories` and related Dependabot/secret-scanning flags | No       | New-repository security defaults.                                              |
| `actions_variables[]`                                                                         | No       | Organization Actions variables (below).                                        |
| `org_secrets`                                                                                 | No       | Organization secrets by domain: `actions`, `codespaces`, `dependabot` (below). |

### `actions_variables[]`

| Field                   | Required       | Description                                                                 |
| ----------------------- | -------------- | --------------------------------------------------------------------------- |
| `name`                  | Yes            | Variable name (`^[A-Za-z0-9_]+$`).                                          |
| `value`                 | Yes            | Variable value, or a `ref:secretsclaim:<name>:<key>` reference (see below). |
| `visibility`            | Yes            | `all`, `private`, or `selected`.                                            |
| `selected_repositories` | For `selected` | `component:<name>` references. Resolved to `org/repo` strings.              |

### Secret references in `value`

A `value` of `ref:secretsclaim:<secret-claim>:<key>` reads the key from a
`SecretsClaim`, the same way repository variables do. The provisioner resolves
it at apply time, and the rendered CR never contains the secret.

```yaml
actions_variables:
  - name: DEPLOY_HOST
    value: ref:secretsclaim:deploy_secrets:host
    visibility: all
```

> **Warning:** GitHub stores the resolved value as plain text, and it is also
> written to Terraform state. Refs work for every visibility, but real secrets
> belong in `org_secrets`, which encrypts them before they reach GitHub.

A reference to a missing `SecretsClaim` or to a key it does not declare fails at
render time, naming `actions_variables.<name>`.

### `org_secrets`

`org_secrets` holds three independent arrays: `actions`, `codespaces` and
`dependabot`. The renderer emits one `FirestartrGithubOrganizationSecretSection`
per organization per render pass; duplicate secret names within a domain are
rejected, and two claims cannot target the same organization.

| Field                   | Required       | Description                                                                              |
| ----------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `name`                  | Yes            | Secret name (`^[A-Za-z0-9_]+$`), unique within its domain.                               |
| `value`                 | Yes            | `ref:secretsclaim:<claim>:<key>` reference to the plaintext secret.                      |
| `visibility`            | No             | `all` (default), `private`, or `selected`.                                               |
| `selected_repositories` | For `selected` | `component:<name>` references. Resolved to `org/repo` strings; at least one is required. |

Values are read from the Kubernetes `Secret` the `SecretsClaim` resolves to,
encrypted with the organization public key of the matching domain, and handed to
Terraform already encrypted. A SHA-256 fingerprint of the plaintext is stored per
name (`actions_sha256`, `codespaces_sha256`, `dependabot_sha256`); ciphertext
changes are ignored in the diff and the fingerprint triggers the replacement, so
a changed value rewrites the secret without leaking it into the plan.

Codespaces and Dependabot organization secrets depend on the organization plan
and on the GitHub App having the `codespaces_secrets` / `dependabot_secrets`
organization permissions; omit those domains when they are not available.

## Rendering

- `FirestartrGithubOrganizationSettings`: `metadata.name` is the normalized
  `providers.github.name` with the state key appended (`<name>-<tfStateKey>`);
  each settings field is copied into `spec` (camelCased). Fields not set on the
  claim are omitted.
- `FirestartrGithubOrganizationVariableSection`: `metadata.name` is the
  normalized `providers.github.name` with the state key appended
  (`<name>-<tfStateKey>`); `spec.actionsVariables` is an array of
  `{ name, value, visibility, selectedRepositories? }`. A `ref:secretsclaim` value
  becomes `{ name, ref: { kind: 'Secret', name, key }, visibility }` instead, and the
  provisioner resolves it. A `selected` variable's
  `selected_repositories` (claim) becomes `selectedRepositories` holding `org/repo`
  strings. The write connection Secret exposes `managed_variables` and
  `variable_ids`.
- `FirestartrGithubOrganizationSecretSection`: `metadata.name` is the same
  normalized name with a **distinct** state key, so both workspaces can coexist;
  `spec.secrets` is `{ actions, codespaces, dependabot }`, each an array of
  `{ name, ref, visibility, selectedRepositories }` where `ref` points at the
  Kubernetes `Secret` and key. The CR is treated as a one-way definition: removing
  entries from the claim removes the secrets, and re-renders never re-add entries
  from the previous CR. The write connection Secret exposes
  `actions_secret_names`, `codespaces_secret_names` and `dependabot_secret_names`.
  Claim-level `selected_repositories` entries are `component:<name>` references
  resolved to `org/repo` strings at render time.

## Imports and adoption

- Organization settings: `github_organization_settings.this` with ID `spec.org`.
- Variables: **apply-time adoption only.** On `apply`, the entity reads its
  `managed_variables` self-output, checks each declared name against the GitHub
  API, and records existing ones for import. `401`/`403` and unexpected errors are
  skipped (logged), letting Terraform continue. An explicit `import` operation
  discovers nothing.
- Secrets: **apply-time adoption per domain.** On `apply`, the entity reads the
  `<domain>_secret_names` self-output, and for every declared name that is new to
  the module checks GitHub. Existing secrets are imported for that domain, their
  fingerprint is dropped so Terraform rewrites the value, and — for `actions` and
  `dependabot` `selected` secrets — the repository binding is imported too.
  Codespaces keeps the repository list inline on the secret. `401`/`403` and
  unexpected errors are skipped (logged). An explicit `import` discovers nothing.
  With the pinned module, the importing apply does **not** write the declared
  value: the external value stays active until a later reconciliation. `PROVISIONED`
  after an adoption therefore does not confirm that the claim's value is live. To
  force that reconciliation, set the `firestartr.dev/reconcile-at` annotation on
  the `FirestartrGithubOrganizationSecretSection` CR to a current timestamp
  (for example `date -u +%Y-%m-%dT%H:%M:%SZ`).

## Notes

- `spec.org` selects the organization; `providers.github.name` does not. Keep the
  referenced GitHub provider's owner aligned with `org`.
- The claim's `selected_repositories` entries are `component:<name>` references;
  the renderer resolves them to `org/repo` strings on the CR. The provisioner
  maps the CR array into a module object keyed by variable or secret name and
  renames `selectedRepositories` to `selectedRepositoryIds` for variables; no
  numeric-ID conversion is performed.
- GitHub never returns a secret's value. Verifying a provisioned value requires a
  consumer: only `actions` organization secrets are readable from a workflow as
  `secrets.<name>`. Codespaces and Dependabot secrets can only be asserted by
  existence and visibility through the API.

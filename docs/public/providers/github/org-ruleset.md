# OrgRulesetClaim

An `OrgRulesetClaim` provisions one GitHub organization ruleset. It replaces
per-repository branch protections with rules that cover many repositories,
selected by name pattern or by custom property. One claim, one ruleset.

Rendered CR: `FirestartrGithubOrgRuleset` (`firestartr.dev/v1`).
Default module: `github-org-ruleset`.

## Example

```yaml
kind: OrgRulesetClaim
version: "1.0"
name: standard-default-branch
system: "system:platform"
owner: "group:platform-team"
providers:
  github:
    org: my-org
    name: "Standard - Default Branch Protection"
    target: branch
    enforcement: active
    conditions:
      ref_name:
        include: ["~DEFAULT_BRANCH"]
        exclude: []
      repository_name:
        include: ["~ALL"]
        exclude: ["legacy-*"]
    rules:
      - type: deletion
      - type: pull_request
        parameters:
          required_approving_review_count: 1
    bypass_actors:
      - actor_type: Team
        group: "group:platform-team"
        bypass_mode: always
```

## Fields

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Claim identity. |
| `providers.github.org` | Yes | GitHub organization. |
| `providers.github.name` | Yes | Ruleset name shown in GitHub. It may contain spaces, but not `/` (it is used in Terraform workspace paths). |
| `providers.github.target` | Yes | `branch`, `tag` or `push`. |
| `providers.github.enforcement` | Yes | `active`, `evaluate` (report only) or `disabled`. |
| `providers.github.conditions` | Yes | `ref_name` (required for `branch` and `tag`) plus `repository_name` or `repository_property`. `repository_name` entries may be literal names/patterns or `component:<ComponentClaim>` refs. |
| `providers.github.rules` | No | `{type, parameters}` entries. `type` must be one of the known rule types. |
| `providers.github.bypass_actors` | No | `actor_type`, `bypass_mode` and the reference required by that type: `group` for `Team`, `actor_slug` or `actor_id` for `Integration`, `actor_role` or `actor_id` for `RepositoryRole`; `OrganizationAdmin` and `DeployKey` take neither. |
| `providers.github.tfStateKey` | No | Explicit UUID state key. |

## Bypass actors

Team bypass actors reference a `GroupClaim`, not a GitHub slug:

```yaml
bypass_actors:
  - actor_type: Team
    group: "group:platform-team"
    bypass_mode: always
```

The renderer resolves the claim to its `FirestartrGithubGroup` CR, checks that
the team belongs to the ruleset's organization and stores a `ref` in the CR. The
provisioner then resolves that ref to the numeric team id from the group's
Terraform outputs, so a missing group or output fails before the plan instead of
inside a Terraform data lookup.

`Integration` actors still use `actor_slug` (or `actor_id`), and
`RepositoryRole` uses `actor_role` (`maintain`, `write` or `admin`). Neither has
a claim kind to reference; the module resolves those values inside Terraform.

## Targeting repositories by component claim

`repository_name.include` and `repository_name.exclude` accept
`component:<ComponentClaim>` references alongside literal names and patterns:

```yaml
conditions:
  ref_name:
    include: ["~DEFAULT_BRANCH"]
    exclude: []
  repository_name:
    include:
      - "component:test-repo"
      - "component:test-traceability"
      - "test-*"
    exclude: ["component:legacy-test"]
```

The renderer resolves each reference to the repository name of the component
(`firestartr.dev/external-name`), checks that the component belongs to the
ruleset's organization and keeps literal patterns unchanged. A missing
component, a component without a GitHub provider or one from another
organization fails the render. The operator does not need the component CR,
because the ruleset only needs the repository name.

Use `repository_property` instead when the ruleset should follow a repository
property rather than an explicit list of components.

## Validation

The renderer checks the shape, the enums and that each `rules[].type` is a known
type (the list is in `packages/cdk8s_renderer/src/claims/github/rulesetRuleTypes.ts`).
Everything else (rule parameters, which rules fit which target, limits, exactly one
of `repository_name` or `repository_property`) is validated by the Terraform
module. A new GitHub rule type needs a renderer release before it can be used.

The Terraform module takes no organization input: it targets the organization
of the provider config's `owner`. The provisioner resolves the config's
`${{ secrets.* }}` placeholders and rejects a claim whose `providers.github.org`
differs from the resolved owner instead of creating the ruleset in the wrong
organization. When the owner is set outside the provider config (inline block
or env), the check cannot run.

## Rendering

- `metadata.name`: normalized `providers.github.name` with the state key
  appended.
- `spec.org` and `spec.ruleset`. `spec.ruleset` has the shape of the module
  `config`, except Team bypass actors, which are rendered as a
  `FirestartrGithubGroup` ref.
- Team bypass actor refs are resolved to the numeric team id by the provisioner;
  `actor_slug` and `actor_role` (for non-Team actors) are resolved by the module.
- `component:` entries in `repository_name` are resolved to the component's
  repository name at render time and stored as plain names in the CR.

## Import

An existing ruleset with the same name is looked up through the GitHub API and
imported by ID at `github_organization_ruleset.this`. It fails when several
rulesets share the name. Without an import, a ruleset that already exists would be
duplicated.

## Deleting

Deleting the CR destroys the ruleset. Every repository it covered loses that
protection at once, a wider effect than removing one branch protection.

## Migrating from branch protections

1. Create the ruleset with `enforcement: evaluate`.
2. Check it matches the intended repositories and set it to `active`.
3. Set `branchStrategy: none` in the component claim.

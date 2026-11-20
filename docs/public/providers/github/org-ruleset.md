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
        actor_slug: platform-team
        bypass_mode: always
```

## Fields

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Claim identity. |
| `providers.github.org` | Yes | GitHub organization. |
| `providers.github.name` | Yes | Ruleset name shown in GitHub. It may contain spaces. |
| `providers.github.target` | Yes | `branch`, `tag` or `push`. |
| `providers.github.enforcement` | Yes | `active`, `evaluate` (report only) or `disabled`. |
| `providers.github.conditions` | Yes | `ref_name` (required for `branch` and `tag`) plus `repository_name` or `repository_property`. |
| `providers.github.rules` | No | `{type, parameters}` entries. `type` must be one of the known rule types. |
| `providers.github.bypass_actors` | No | `actor_type`, `bypass_mode` and one of `actor_id`, `actor_slug` or `actor_role`. |
| `providers.github.tfStateKey` | No | Explicit UUID state key. |

## Validation

The renderer checks the shape, the enums and that each `rules[].type` is a known
type (the list is in `packages/cdk8s_renderer/src/claims/github/rulesetRuleTypes.ts`).
Everything else (rule parameters, which rules fit which target, limits, exactly one
of `repository_name` or `repository_property`) is validated by the Terraform
module. A new GitHub rule type needs a renderer release before it can be used.

The Terraform module takes no organization input: it targets the organization
of the provider config's `owner`. The provisioner rejects a claim whose
`providers.github.org` differs from that owner instead of creating the ruleset
in the wrong organization. When the owner is set outside the provider config
(inline block or env), the check cannot run.

## Rendering

- `metadata.name`: normalized `providers.github.name` with the state key
  appended.
- `spec.org` and `spec.ruleset`. `spec.ruleset` has the shape of the module
  `config` and is passed to it unchanged.
- Bypass actors given by `actor_slug` or `actor_role` are resolved to IDs by the
  module.

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

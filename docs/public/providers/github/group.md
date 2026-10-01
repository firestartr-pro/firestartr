# GroupClaim (GitHub team)

A `GroupClaim` provisions a GitHub team and its direct members. It also carries
the group identity used by the Backstage catalog (see
[Catalog](/docs/providers/catalog/)).

Rendered CR: `FirestartrGithubGroup` (`firestartr.dev/v1`).
Default module: `github-team`.

## Example

```yaml
kind: GroupClaim
name: group_a
description: "Platform team"
type: "business-unit"
profile:
  displayName: "group_a"
  email: "group-a@example.com"
  picture: "https://example.com/groups/bu-infrastructure.jpeg"
members:
  - "user:user_a"
parent: "group:group_root"
providers:
  github:
    name: group-a
    org: firestartr-test
    privacy: closed
```

## Fields

### Claim-level

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Claim name; also the catalog entity name. |
| `description` | No | Team description (rendered into the CR `spec.description`). |
| `type` | No | Catalog group type. |
| `profile` | No | Catalog profile (`displayName`, `email`, `picture`). |
| `members` | No | Users in the team: `user:<name>` references. |
| `parent` | No | Parent team: `group:<name>` reference. |
| `children` | No | Catalog children. |

### `providers.github`

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | GitHub team name (operational/external name). |
| `org` | Yes | GitHub organization. |
| `privacy` | Yes | `closed` or `secret`. |
| `tfStateKey` | No | Explicit UUID state key. |
| `sync` | No | Scheduled reconciliation (`enabled`, `period`, `schedule`, `schedule_timezone`, `policy`). |

> **Note:** the rendered CR `description` comes from the claim-level
> `description`, not from `providers.github.description`.

## Rendered resource

- `metadata.name`: normalized `providers.github.name` with the state key
  appended (`<name>-<tfStateKey>`).
- `spec.org`, `spec.privacy`, `spec.description`.
- `spec.members[]`: references to `FirestartrGithubMembership` CRs for every
  `user:<name>` member.
- `spec.parentTeam.ref`: reference to the parent `FirestartrGithubGroup` when
  `parent` is set.
- A write connection Secret with outputs `id`, `nodeId`, and `slug`.

## Imports

- `github_team.this` with the team ID (`firestartr.dev/github-id` or the entity's
  own `id` output).
- `github_team_membership.members["<username>"]` with ID `<team-id>:<username>`
  for each emitted member.

## Operational notes

- `spec.org` is not copied into the module config; the GitHub provider owner
  selects the organization.
- Only references whose kind resolves to `FirestartrGithubMembership` produce
  member entries. Other reference kinds are silently ignored.
- If neither the `github-id` annotation nor a self `id` output exists, import IDs
  are undefined and new member entries omit `teamId`.
- Each team's own description is subject to the claim text; keep it under GitHub's
  limits.

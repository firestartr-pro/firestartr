# UserClaim

A `UserClaim` provisions a GitHub organization membership. Every member is also
added to the organization's `<org>-all` team.

Rendered CR: `FirestartrGithubMembership` (`firestartr.dev/v1`).
Default module: `github-membership`.

## Example

```yaml
kind: UserClaim
name: user_a
profile:
  displayName: user_a
  email: user-a@example.com
  picture: https://avatars.githubusercontent.com/u/123456
providers:
  github:
    name: "user-a-github"   # GitHub username
    org: firestartr-test
    role: member            # admin | member
```

## Fields

### `providers.github`

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | GitHub username (operational/external name). |
| `org` | Yes | GitHub organization. |
| `role` | Yes | Organization role: `admin` or `member`. |
| `tfStateKey` | No | Explicit UUID state key. |
| `sync` | No | Scheduled reconciliation. |

## Rendered resource

- `metadata.name`: normalized `providers.github.name` with the state key
  appended (`<name>-<tfStateKey>`); the name itself is the GitHub username.
- `spec.org`, `spec.role`.
- A write connection Secret with no declared outputs.

## Behavior

The entity always adds the member to the `<org>-all` team with role `member`,
independent of the organization `role`. It discovers that team by calling the
GitHub API (`getTeamInfo(<org>-all, <org>)`); a 404 produces an actionable error
naming the claim, user, and org. The membership relation therefore always exists
even when the org role is `member`.

## Imports

- `github_membership.this[0]` with ID `<org>:<username>` (always).
- `github_team_membership.relationships["<username>-<teamId>"]` only when the
  `<org>-all` team membership already exists upstream; otherwise Terraform
  creates it.

## Notes

- Resource loading requires a live GitHub all-team lookup, including for
  plan/import-oriented loads. The claim cannot be synthesized from the CR alone.
- The `<org>-all` relation is always added with role `member`, even for
  organization admins.

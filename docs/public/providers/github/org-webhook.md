# OrgWebhookClaim

An `OrgWebhookClaim` provisions a GitHub organization webhook.

Rendered CR: `FirestartrGithubOrgWebhook` (`firestartr.dev/v1`).
Default module: `github-org-webhook`.

## Example

```yaml
kind: OrgWebhookClaim
version: "1.0"
name: orgwebhook_a
system: "system:system_a"
owner: "group:group_a"
providers:
  github:
    name: my-github-org-webhook
    orgName: firestartr-test
    webhook:
      url: https://example.com/webhook
      contentType: json
      active: true
      events:
        - push
        - pull_request
        - issues
      secretRef: "ref:secretsclaim:secret_a:rds_conn"
```

## Fields

| Field | Required | Description |
| --- | --- | --- |
| `providers.github.name` | Yes | Entity/workspace name (operational/external name). |
| `providers.github.orgName` | Yes | GitHub organization. |
| `providers.github.webhook.url` | Yes | Webhook endpoint URL. |
| `providers.github.webhook.contentType` | Yes | `json` or `form`. |
| `providers.github.webhook.events` | Yes | List of triggering events (e.g. `push`, `pull_request`, `issues`). |
| `providers.github.webhook.secretRef` | Yes | Secret reference in `ref:secretsclaim:<claim>:<key>` form. |
| `providers.github.webhook.active` | No | Defaults to `true` when omitted. |
| `providers.github.tfStateKey` | No | Explicit UUID state key. |

## Rendering

- `metadata.name`: normalized `providers.github.name` with the state key
  appended (`<name>-<tfStateKey>`).
- `spec.orgName`, `spec.webhook.{url, contentType, events, active, secretRef}`.
- `spec.webhook.secretRef` is resolved to a `Secret` reference (`name` + `key`).
  The referenced Secret normally comes from an `ExternalSecret` rendered by a
  [SecretsClaim](/docs/providers/external_secrets/).
- `insecureSsl` is always the entity default (`false`); it is not a claim-level
  field, so it cannot be supplied here.

## Import

The entity lists organization webhooks through the GitHub API and selects the
first whose configuration URL equals `spec.webhook.url`; it imports the numeric ID
at `github_organization_webhook.this`.

## Notes

- The organization is expected to match the referenced GitHub provider owner;
  `orgName` is not carried inside the module config.
- Import identity is **URL-only**. If multiple hooks share a URL the first match
  wins; if none matches, the import lookup fails and throws.
- The claim's `secretRef` accepts only a `ref:secretsclaim:<claim>:<key>`
  string; the chart always renders `kind: Secret`. An explicit `kind` can only
  be introduced by editing the rendered CR directly, not supplied by the claim.

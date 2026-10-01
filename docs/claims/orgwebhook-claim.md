# Claim OrgWebhookClaim

An organization webhook claim manages organization-level webhooks in GitHub, enabling automated integration and event handling across all repositories in an organization. It provides a centralized way to handle events across all repositories within an organization and enables automated workflows, CI/CD pipelines, and integration with external systems.

## Example

```yaml
kind: OrgWebhookClaim
name: ci-cd-webhook
version: "1.0"
description: "Organization webhook for CI/CD automation"
type: "automation"
lifecycle: "production"
profile:
  displayName: "CI/CD Webhook"
  email: "devops@example.com"
  picture: "https://example.com/icons/webhook.png"
annotations:
  team: "devops"
  purpose: "automation"
providers:
  github:
    name: "org-cicd-automation"
    orgName: "myorganization"
    webhook:
      url: "https://cicd.mycompany.com/webhooks/github"
      active: true
      contentType: "json"
      events:
        - "push"
        - "pull_request"
        - "pull_request_review"
        - "release"
        - "create"
        - "delete"
      secretRef: "ref:secretsclaim:webhook-secrets:github_webhook_secret"
```

## API

```yaml
# Base ClaimEnvelope properties (inherited)
name: string                    # Required. The name of the claim
kind: string                   # Required. Must be "OrgWebhookClaim"
description: string            # Optional. A description of the claim
type: string                   # Optional. Webhook type
lifecycle: string              # Optional. Lifecycle stage
version: string                # Optional. Version of the claim
providers: object              # Required. Provider configurations
profile: object                # Optional. Webhook profile information
  displayName: string          # Optional. Display name for the webhook
  email: string               # Optional. Contact email
  picture: string             # Optional. Webhook icon/logo URL
annotations: object            # Optional. Key-value annotations
  # Pattern properties: '^[a-zA-Z0-9/.-]+$'
  <key>: string               # Annotation value

# Provider configurations
providers:
  github: object              # Optional. GitHub provider configuration
    name: string              # Required. Webhook name/identifier
    orgName: string           # Required. GitHub organization name
    webhook: object           # Required. Webhook configuration
      url: string             # Required. Webhook endpoint URL
      contentType: string     # Required. Content type
        # Enum values: ["json", "form"]
      active: boolean         # Optional. Whether webhook is active
      events: array           # Required. List of GitHub events to trigger webhook
        - string              # Required. Event name (e.g., "push", "pull_request")
      secretRef: string       # Required. Reference to webhook secret (pattern: '^ref:secretsclaim:([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)$')
```
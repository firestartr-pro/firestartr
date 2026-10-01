# Claim DomainClaim

A domain claim defines a business domain that represents a specific area of business functionality and groups related systems together. It represents the highest level of business organization in your architecture and helps structure your organization around business capabilities rather than technical concerns.

## Example

```yaml
kind: DomainClaim
name: identity
version: "1.0"
description: "Identity and access management domain covering authentication, authorization, and user management"
type: "core-platform"
lifecycle: "production"
owner: "group:platform-team"
profile:
  displayName: "Identity Domain"
  email: "platform-team@example.com"
  picture: "https://example.com/domains/identity.png"
annotations:
  business-area: "platform"
  strategic-priority: "high"
providers:
  catalog: {}
```

## API

```yaml
# Base ClaimEnvelope properties (inherited)
name: string                    # Required. The name of the claim
kind: string                   # Required. Must be "DomainClaim"
description: string            # Required. A description of the domain
type: string                   # Optional. Domain type
lifecycle: string              # Optional. Lifecycle stage
version: string                # Optional. Version of the claim
providers: object              # Required. Provider configurations
profile: object                # Optional. Domain profile information
  displayName: string          # Optional. Display name for the domain
  email: string               # Optional. Contact email
  picture: string             # Optional. Domain icon/logo URL
annotations: object            # Optional. Key-value annotations
  # Pattern properties: '^[a-zA-Z0-9/.-]+$'
  <key>: string               # Annotation value

# DomainClaim specific properties
description: string            # Required. A description of the domain (also inherited from base)
owner: string                  # Required. Domain owner reference

# Provider configurations
providers:
  catalog: object              # Optional. Catalog provider (typically empty object)
```
# Claim SystemClaim

A system claim defines a business system that groups related components together, providing organizational structure for your architecture. It represents logical business systems within your architecture and provides a hierarchical organization structure under DomainClaims.

## Example

```yaml
kind: SystemClaim
name: user-management-system
version: "1.0"
description: "User management and authentication system"
type: "platform"
lifecycle: "production"
domain: "domain:identity"
owner: "group:platform-team"
profile:
  displayName: "User Management System"
  email: "platform-team@example.com"
  picture: "https://example.com/systems/user-management.png"
annotations:
  cost-center: "engineering"
  business-unit: "platform"
providers:
  catalog: {}
```

## API

```yaml
# Base ClaimEnvelope properties (inherited)
name: string                    # Required. The name of the claim
kind: string                   # Required. Must be "SystemClaim"
description: string            # Optional. A description of the claim
type: string                   # Optional. System type
lifecycle: string              # Optional. Lifecycle stage
version: string                # Optional. Version of the claim
providers: object              # Required. Provider configurations
profile: object                # Optional. System profile information
  displayName: string          # Optional. Display name for the system
  email: string               # Optional. Contact email
  picture: string             # Optional. System icon/logo URL
annotations: object            # Optional. Key-value annotations
  # Pattern properties: '^[a-zA-Z0-9/.-]+$'
  <key>: string               # Annotation value

# SystemClaim specific properties
name: string                   # Required. The name of the system (also inherited from base)
domain: string                 # Optional. Reference to parent domain (pattern: '^domain:.+$')
owner: string                  # Optional. System owner reference (pattern: '^[^:]+:[^:]+$')

# Provider configurations
providers:
  catalog: object              # Optional. Catalog provider (typically empty object)
```
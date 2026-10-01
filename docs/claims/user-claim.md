# Claim UserClaim

A user claim manages individual user memberships within GitHub organizations, defining user profile information and their role within the specified GitHub organization.

## Example

```yaml
kind: UserClaim
name: john-doe
version: "1.0"
description: "Developer account for John Doe"
type: "developer"
lifecycle: "active"
profile:
  displayName: "John Doe"
  email: "john.doe@example.com"
  picture: "https://avatars.githubusercontent.com/u/123456?v=4"
annotations:
  team: "backend"
  department: "engineering"
providers:
  github:
    name: "john-doe-github"
    org: "myorganization"
    role: "member"
```

## API

```yaml
# Base ClaimEnvelope properties (inherited)
name: string                    # Required. The name of the claim
kind: string                   # Required. Must be "UserClaim"
description: string            # Optional. A description of the claim
type: string                   # Optional. User type
lifecycle: string              # Optional. Lifecycle stage
version: string                # Optional. Version of the claim
providers: object              # Required. Provider configurations
profile: object                # Optional. User profile information
  displayName: string          # Optional. Display name for the user
  email: string               # Optional. User's email address
  picture: string             # Optional. URL to user's profile picture
annotations: object            # Optional. Key-value annotations
  # Pattern properties: '^[a-zA-Z0-9/.-]+$'
  <key>: string               # Annotation value

# UserClaim specific properties
providers:
  github: object              # Optional. GitHub provider configuration
    name: string              # Required. GitHub username
    org: string               # Required. GitHub organization name
    role: string              # Required. Role in organization
      # Enum values: ["admin", "member"]
```
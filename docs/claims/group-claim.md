# Claim GroupClaim

A group claim manages GitHub teams within organizations, defining team membership, hierarchy, and access permissions. It enables structured organization of users into teams that can be granted permissions to repositories and other resources.

## Example

```yaml
kind: GroupClaim
name: backend-team
version: "1.0"
description: "Backend development team"
type: "team"
lifecycle: "active"
profile:
  displayName: "Backend Team"
  email: "backend-team@example.com"
  picture: "https://example.com/teams/backend.png"
parent: "group:engineering"
members:
  - "user:john-doe"
  - "user:jane-smith"
children:
  - "group:api-team"
  - "group:database-team"
annotations:
  department: "engineering"
  cost-center: "product"
providers:
  github:
    name: "backend-team"
    description: "Team responsible for backend development"
    org: "myorganization"
    privacy: "closed"
```

## API

```yaml
# Base ClaimEnvelope properties (inherited)
name: string                    # Required. The name of the claim
kind: string                   # Required. Must be "GroupClaim"
description: string            # Optional. A description of the claim
type: string                   # Optional. Group type
lifecycle: string              # Optional. Lifecycle stage
version: string                # Optional. Version of the claim
providers: object              # Required. Provider configurations
profile: object                # Optional. Group profile information
  displayName: string          # Optional. Display name for the group
  email: string               # Optional. Group's contact email
  picture: string             # Optional. URL to group's profile picture
annotations: object            # Optional. Key-value annotations
  # Pattern properties: '^[a-zA-Z0-9/.-]+$'
  <key>: string               # Annotation value

# GroupClaim specific properties
children: array                # Optional. List of child groups
  - string                    # Child group reference
parent: string                 # Optional. Reference to parent group (pattern: '^[^:]+:[^:]+$')
members: array                 # Optional. List of group members
  - string                    # Member reference

# Provider configurations
providers:
  github: object              # Optional. GitHub provider configuration
    name: string              # Required. GitHub team name
    description: string       # Optional. Team description
    org: string               # Required. GitHub organization name
    privacy: string           # Required. Team privacy level
      # Enum values: ["closed", "secret"]
```
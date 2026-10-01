# Claim ComponentClaim

A component claim defines an application component with its associated GitHub repository, ownership, and system relationships. It represents individual application components within your system architecture and manages the GitHub repository for the component.

## Example

```yaml
kind: ComponentClaim
name: user-service
version: "1.0"
description: "User management microservice"
type: "service"
lifecycle: "production"
system: "system:user-management"
owner: "group:backend-team"
maintainedBy: 
  - "group:platform-team"
  - "group:sre-team"
platformOwner: "group:platform-team"
subComponentOf: "component:user-platform"
profile:
  displayName: "User Service"
  email: "backend-team@example.com"
  picture: "https://example.com/icons/user-service.png"
annotations:
  team: "backend"
  cost-center: "engineering"
providers:
  github:
    name: "user-service"
    description: "User management microservice"
    org: "myorganization"
    visibility: "private"
    features:
      - name: "nodejs-service"
        version: "1.2.0"
        args:
          installOnBranch: "main"
      - name: "docker-ci"
        ref: "v2.1.0"
        repo: "myorg/features"
    vars:
      actions:
        - name: "NODE_VERSION"
          value: "18"
        - name: "BUILD_ENV" 
          value: "production"
    secrets:
      actions:
        - name: "DATABASE_URL"
          value: "ref:secretsclaim:app-secrets:db_url"
      dependabot:
        - name: "NPM_TOKEN"
          value: "ref:secretsclaim:npm-secrets:token"
```

## API

```yaml
# Base ClaimEnvelope properties (inherited)
name: string                    # Required. The name of the claim
kind: string                   # Required. Must be "ComponentClaim"
description: string            # Optional. A description of the claim
type: string                   # Optional. Component type
lifecycle: string              # Optional. Lifecycle stage
version: string                # Optional. Version of the claim
providers: object              # Required. Provider configurations
profile: object                # Optional. Component profile information
  displayName: string          # Optional. Display name for the component
  email: string               # Optional. Contact email
  picture: string             # Optional. Component icon/logo URL
annotations: object            # Optional. Key-value annotations
  # Pattern properties: '^[a-zA-Z0-9/.-]+$'
  <key>: string               # Annotation value

# ComponentClaim specific properties
system: string                 # Optional. Reference to parent system (pattern: '^system:.+$')
owner: string                  # Required. Component owner (pattern: '^[^:]+:[^:]+$')
maintainedBy: array           # Optional. List of maintainers
  - string                    # Maintainer reference (pattern: '^[^:]+:[^:]+$')
platformOwner: string         # Optional. Platform owner reference (pattern: '^[^:]+:[^:]+$')
subComponentOf: string        # Optional. Reference to parent component (pattern: '^component:[^:]+$')

# Provider configurations
providers:
  github: object              # Optional. GitHub provider configuration
    name: string              # Required. GitHub repository name
    description: string       # Optional. Repository description
    org: string               # Required. GitHub organization name
    visibility: string        # Required. Repository visibility
      # Enum values: ["private", "public", "internal"]
    features: array           # Optional. List of installed features
      - object                # Feature configuration
        name: string          # Required. Feature name
        version: string       # Optional. Feature version (exclusive with ref)
        ref: string           # Optional. GitHub reference (exclusive with version, pattern: '^[a-zA-Z0-9-._@/]+$')
        repo: string          # Optional. Feature repository (pattern: '^[a-zA-Z0-9-._]+/[a-zA-Z0-9-._]+$')
        args: object          # Optional. Feature arguments (additionalProperties: true)
    vars: object              # Optional. Repository variables
      actions: array          # Optional. GitHub Actions variables
        - object              # Variable configuration
          name: string        # Required. Variable name
          value: string       # Required. Variable value
    secrets: object           # Optional. Repository secrets
      actions: array          # Optional. GitHub Actions secrets
        - object              # Secret configuration
          name: string        # Required. Secret name
          value: string       # Required. Secret reference (pattern: '^ref:secretsclaim:([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)$')
      codespaces: array       # Optional. GitHub Codespaces secrets
        - object              # Secret configuration
          name: string        # Required. Secret name
          value: string       # Required. Secret reference (pattern: '^ref:secretsclaim:([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)$')
      dependabot: array       # Optional. Dependabot secrets
        - object              # Secret configuration
          name: string        # Required. Secret name
          value: string       # Required. Secret reference (pattern: '^ref:secretsclaim:([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)$')
```
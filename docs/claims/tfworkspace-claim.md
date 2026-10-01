# Claim TFWorkspaceClaim

A TF workspace claim defines a Terraform workspace that manages infrastructure resources as code, with automated provisioning and lifecycle management. It manages infrastructure as code using Terraform and defines workspaces that provision and manage cloud resources.

## Example

```yaml
kind: TFWorkspaceClaim
name: postgres-production
version: "1.0"
description: "Production PostgreSQL cluster"
type: "database"
lifecycle: "production"
resourceType: "database-cluster"
system: "system:data-platform"
owner: "group:platform-team"
profile:
  displayName: "Production PostgreSQL"
  email: "platform-team@example.com"
  picture: "https://example.com/icons/postgres.png"
annotations:
  cost-center: "infrastructure"
  environment: "production"
providers:
  terraform:
    name: "postgres-prod-cluster"
    source: "Remote"
    module: "https://github.com/myorg/terraform-modules/database-cluster@v2.1.0"
    valuesSchema: "file:/schemas/database-cluster-schema.json"
    values:
      cluster_name: "postgres-production"
      instance_type: "db.r6g.xlarge"
      storage_size: 1000
      backup_retention: 30
    context:
      providers:
        - name: "aws-us-east-1"
      backend:
        name: "s3-backend-prod"
    policy: "create-update-only"
    sync:
      enabled: true
      period: "1h"
      policy: "apply"
```

## API

```yaml
# Base ClaimEnvelope properties (inherited)
name: string                    # Required. The name of the claim
kind: string                   # Required. Must be "TFWorkspaceClaim"
description: string            # Optional. A description of the claim
type: string                   # Optional. Workspace type
lifecycle: string              # Optional. Lifecycle stage
version: string                # Optional. Version of the claim
providers: object              # Required. Provider configurations
profile: object                # Optional. Workspace profile information
  displayName: string          # Optional. Display name for the workspace
  email: string               # Optional. Contact email
  picture: string             # Optional. Workspace icon/logo URL
annotations: object            # Optional. Key-value annotations
  # Pattern properties: '^[a-zA-Z0-9/.-]+$'
  <key>: string               # Annotation value

# TFWorkspaceClaim specific properties
resourceType: string           # Optional. Type of resources managed
system: string                 # Optional. Reference to parent system (pattern: '^system:.+$')
owner: string                  # Required. Workspace owner (pattern: '^[^:]+:[^:]+$')

# Provider configurations
providers:
  terraform: object            # Required. Terraform provider configuration
    name: string              # Required. Terraform workspace name
    source: string            # Required. Source type
      # Enum values: ["remote", "inline", "Remote", "Inline"]
    module: string            # Required. Terraform module source
    values: object            # Required. Input variables for the module (additionalProperties: true)
    valuesSchema: string      # Optional. JSON schema URL for values validation
    context: object           # Required. Terraform execution context
      providers: array        # Required. List of Terraform providers
        - object              # Provider configuration
          name: string        # Required. Provider name
      backend: object         # Optional. Terraform backend configuration
        name: string          # Required. Backend name
    policy: string            # Optional. Workspace policy
      # Enum values: ["apply", "create-only", "create-update-only", "full-control", "observe", "observe-only"]
    sync: object              # Optional. Synchronization settings
      enabled: boolean        # Required. Enable automatic synchronization
      period: string          # Optional. Sync period (pattern: '^[0-9]+[smhd]$')
      schedule: string        # Optional. Cron-like schedule
      schedule_timezone: string # Optional. Timezone for schedule
      policy: string          # Optional. Sync policy
```
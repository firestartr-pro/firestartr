# Claim SecretsClaim

A secrets claim manages secrets in Kubernetes using the External Secrets Operator, enabling secure synchronization of secrets from external secret stores. It provides secure synchronization between external secret stores and Kubernetes secrets, supporting both pulling secrets from external stores and pushing generated secrets to them.

## Example

```yaml
kind: SecretsClaim
name: app-secrets
version: "1.0"
description: "Application secrets for user service"
type: "application"
lifecycle: "production"
system: "system:user-management"
profile:
  displayName: "App Secrets"
  email: "platform-team@example.com"
  picture: "https://example.com/icons/secrets.png"
annotations:
  team: "backend"
  security-level: "high"
providers:
  external_secrets:
    name: "app-secrets-store"
    secretStore:
      kind: "SecretStore"
      name: "aws-secrets-manager"
    pushSecrets:
      - secretName: "database-password"
        refreshInterval: "90d"
        generator:
          name: "pg-password-generator"
          kind: "Password"
          apiVersion: "external-secrets.io/v1alpha1"
          outputKey: "password"
          conversionStrategy: "None"
        data:
          username: "postgres"
        template:
          type: "Opaque"
    externalSecrets:
      refreshInterval: "1h"
      secrets:
        - secretName: "database-credentials"
          remoteRef: "prod/database/credentials"
        - secretName: "third-party-api-keys"
          remoteRef: "prod/integrations/api-keys"
```

## API

```yaml
# Base ClaimEnvelope properties (inherited)
name: string                    # Required. The name of the claim
kind: string                   # Required. Must be "SecretsClaim"
description: string            # Optional. A description of the claim
type: string                   # Optional. Secrets type
lifecycle: string              # Optional. Lifecycle stage
version: string                # Optional. Version of the claim
providers: object              # Required. Provider configurations
profile: object                # Optional. Secrets profile information
  displayName: string          # Optional. Display name for the secrets
  email: string               # Optional. Contact email
  picture: string             # Optional. Secrets icon/logo URL
annotations: object            # Optional. Key-value annotations
  # Pattern properties: '^[a-zA-Z0-9/.-]+$'
  <key>: string               # Annotation value

# SecretsClaim specific properties
system: string                 # Optional. Reference to parent system (pattern: '^system:[^:]+$')

# Provider configurations (anyOf: external secrets OR push secrets)
providers:
  external_secrets: object     # Required. External Secrets provider configuration
    name: string              # Required. SecretStore name
    secretStore: object       # Required. SecretStore configuration
      name: string            # Required. SecretStore name
      kind: string            # Optional. SecretStore kind
        # Enum values: ["SecretStore", "ClusterSecretStore"]
    
    # Option 1: External Secrets (pull secrets from external store)
    externalSecrets: object   # Required when using external secrets
      refreshInterval: string # Optional. Refresh interval for external secrets
      secrets: array          # Optional. List of external secrets to sync
        - object              # External secret configuration
          secretName: string  # Required. Name of the secret in Kubernetes
          remoteRef: string   # Optional. Reference to the external secret
    
    # Option 2: Push Secrets (generate and push secrets to external store)
    pushSecrets: array        # Required when using push secrets
      - object                # Push secret configuration
        secretName: string    # Required. Name of the Kubernetes secret
        refreshInterval: string # Optional. Refresh interval
        generator: object     # Required. Secret generator configuration
          name: string        # Required. Generator name
          kind: string        # Optional. Generator kind
            # Enum values: ["ACRAccessToken", "ClusterGenerator", "ECRAuthorizationToken", "Fake", "GCRAccessToken", "GithubAccessToken", "QuayAccessToken", "Password", "STSSessionToken", "UUID", "VaultDynamicSecret", "Webhook", "Grafana"]
          apiVersion: string  # Optional. Generator API version
          conversionStrategy: string # Optional. Conversion strategy
          outputKey: string   # Optional. Output key for generated secret
        data: object          # Optional. Secret data
        template: object      # Optional. Secret template
```
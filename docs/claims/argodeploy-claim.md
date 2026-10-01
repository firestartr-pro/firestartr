# Claim ArgoDeployClaim

An ArgoCD Deploy claim defines an ArgoCD application deployment, managing the continuous delivery of applications to Kubernetes clusters using GitOps principles. It manages application deployments using ArgoCD and implements GitOps principles for continuous delivery.

## Example

```yaml
kind: ArgoDeployClaim
name: redis-deploy
version: "1.0"
description: "Redis deployment for caching layer"
type: "database"
lifecycle: "production"
system: "system:data-platform"
project: "data-platform"
profile:
  displayName: "Redis Deployment"
  email: "platform-team@example.com"
  picture: "https://example.com/icons/redis.png"
annotations:
  team: "platform"
  environment: "production"
providers:
  argocd:
    name: "redis-production"
    project: "default"
    chart:
      name: "redis"
      source: "registry-1.docker.io/bitnamicharts"
      version: "18.12.1"
      oci: true
    values:
      - source: "https://github.com/myorg/app-configs"
        paths:
          - "/redis/production-values.yaml"
          - "/redis/common-values.yaml"
        revision: "main"
    destination:
      namespace: "redis"
      server: "https://kubernetes.default.svc"
      name: "production-cluster"
```

## API

```yaml
# Base ClaimEnvelope properties (inherited)
name: string                    # Required. The name of the claim
kind: string                   # Required. Must be "ArgoDeployClaim"
description: string            # Optional. A description of the claim
type: string                   # Optional. Deployment type
lifecycle: string              # Optional. Lifecycle stage
version: string                # Optional. Version of the claim
providers: object              # Required. Provider configurations
profile: object                # Optional. Deployment profile information
  displayName: string          # Optional. Display name for the deployment
  email: string               # Optional. Contact email
  picture: string             # Optional. Deployment icon/logo URL
annotations: object            # Optional. Key-value annotations
  # Pattern properties: '^[a-zA-Z0-9/.-]+$'
  <key>: string               # Annotation value

# ArgoDeployClaim specific properties
system: string                 # Optional. Reference to parent system (pattern: '^system:.+$')
project: string                # Optional. ArgoCD project name

# Provider configurations
providers:
  argocd: object              # Required. ArgoCD provider configuration
    name: string              # Required. ArgoCD application name
    project: string           # Optional. ArgoCD project name
    chart: object             # Optional. Helm chart configuration
      name: string            # Required. Chart name
      version: string         # Required. Chart version
      oci: boolean            # Optional. Whether chart is OCI-based (default: false)
      source: string          # Required. Chart repository URL or registry
    values: array             # Optional. Values sources for the application
      - object                # Values source configuration
        source: string        # Required. Git repository URL for values
        paths: array          # Required. Paths to value files
          - string            # Required. Path to values file
        revision: string      # Required. Git branch/tag/commit
    destination: object       # Optional. Deployment destination
      namespace: string       # Optional. Target Kubernetes namespace
      server: string          # Optional. Kubernetes cluster server URL
      name: string            # Optional. Cluster name
```
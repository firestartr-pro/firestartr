# External Secrets Provider

The `external_secrets` provider renders [External Secrets Operator](https://external-secrets.io/latest/)
resources from a `SecretsClaim`. It supports both directions:

- **Pull** (`externalSecrets`) — an `external-secrets.io/v1` `ExternalSecret` that
  fetches keys from an external provider into a Kubernetes Secret.
- **Push** (`pushSecrets`) — an `external-secrets.io/v1alpha1` `PushSecret` that
  pushes a generated secret to an external provider.

> **This provider does not configure your secrets backend.** It references an
> **existing** `SecretStore` or `ClusterSecretStore`. Installing the External
> Secrets Operator, creating the store, and configuring its provider (AWS
> Secrets Manager/Parameter Store, Vault, Azure Key Vault, …) are separate
> concerns. See the [External Secrets documentation](https://external-secrets.io/latest/).

## Example

```yaml
kind: SecretsClaim
name: secret_a
system: system:system_a
owner: group:group_a
version: "1.0"
providers:
  external_secrets:
    name: app-tenant-env
    secretStore:
      name: app-tenant-env
      kind: SecretStore           # SecretStore | ClusterSecretStore (default SecretStore)
    externalSecrets:              # pull
      refreshInterval: 90d
      secrets:
        - secretName: rds_conn
          remoteRef: rds_conn
    pushSecrets:                  # push
      - secretName: my-postgres
        refreshInterval: 90d
        generator:
          name: pg-generator
          kind: Password
```

A claim must declare `secretStore` and **at least one** of `externalSecrets` or
`pushSecrets`.

## Fields

### `providers.external_secrets`

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Entity/external name; recorded as an annotation. |
| `secretStore` | Yes | Reference to an existing store (below). |
| `externalSecrets` | One of | Pull configuration. |
| `pushSecrets` | One of | Push configuration. |

### `secretStore`

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Name of the existing `SecretStore`/`ClusterSecretStore`. |
| `kind` | No | `SecretStore` or `ClusterSecretStore`. Defaults to `SecretStore`. |

### `externalSecrets` (pull)

| Field | Required | Description |
| --- | --- | --- |
| `refreshInterval` | No | How often to refresh. Defaults to `1y`. |
| `secrets[]` | No | List of pulled keys. |
| `secrets[].secretName` | Yes | Kubernetes Secret key. |
| `secrets[].remoteRef` | No | Remote key; defaults to `secretName`. |

### `pushSecrets[]` (push)

| Field | Required | Description |
| --- | --- | --- |
| `secretName` | Yes | Target remote name and default remote key. |
| `refreshInterval` | No | Push refresh interval. Defaults to `5m`. |
| `updatePolicy` | No | Defaults to `Replace`. |
| `deletionPolicy` | No | Defaults to `None`. |
| `conversionStrategy` | No | Defaults to `None`. |
| `generator` | Yes | Generator used to produce the secret value. |
| `data` / `template` | No | Accepted by the schema but **not rendered** — see Notes. |
| `generator.conversionStrategy` | No | Accepted by the schema but **not rendered** — see Notes. |

### `generator`

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Name of the generator resource. |
| `kind` | No | Generator kind. Defaults to `Password`. |
| `apiVersion` | No | Defaults to `generators.external-secrets.io/v1`. |
| `outputKey` | No | Secret key produced. Defaults to `password`. |

Supported generator kinds: `ACRAccessToken`, `ClusterGenerator`,
`ECRAuthorizationToken`, `Fake`, `GCRAccessToken`, `GithubAccessToken`,
`QuayAccessToken`, `Password`, `STSSessionToken`, `UUID`, `VaultDynamicSecret`,
`Webhook`, `Grafana`. These are External Secrets generator resource kinds — they
identify which controller-side generator produces the value; they are not cloud
integrations implemented by Firestartr.

## Rendered resources

### `ExternalSecret`

- `metadata.name`: normalized claim name.
- `spec.refreshInterval`: `externalSecrets.refreshInterval` or `1y`.
- `spec.secretStoreRef`: `{ name, kind }` from `secretStore` (kind defaults to
  `SecretStore`).
- `spec.target`: `{ name: <normalized claim name>, creationPolicy: Owner, deletionPolicy: Delete }`.
- `spec.data[]`: one entry per `secrets[]`, with `secretKey` = `secretName` and
  `remoteRef.key` = `remoteRef` or `secretName`.

All secrets in a single claim are merged into **one** `ExternalSecret` with
multiple `data` entries.

### `PushSecret`

- `metadata.name`: `<secretName>-<claim-name>` normalized.
- `spec.updatePolicy` / `spec.deletionPolicy` / `spec.refreshInterval`.
- `spec.secretStoreRefs[]`: `{ kind, name }` from `secretStore`.
- `spec.selector.generatorRef`: `{ apiVersion, kind, name }` from `generator`.
- `spec.data[]`: `conversionStrategy` and a `match` with
  `remoteRef.remoteKey = secretName` and
  `secretKey = generator.outputKey || password`.

One `PushSecret` is rendered per `pushSecrets` entry.

Both resources carry `firestartr.dev/claim-ref` and `firestartr.dev/external-name`
annotations.

## Notes

- **Reference, not configuration.** The store must already exist. The rendered
  resources only point at it.
- **Renderer modes.** A `SecretsClaim` renders in the `externalSecrets` and `all`
  renderer modes, and also under the legacy `terraform` mode.
- **`data`, `template`, and `generator.conversionStrategy` are declarative-only.**
  The claim schema accepts them on `pushSecrets[]`, but the renderer does not copy
  them into the generated `PushSecret`. Only the top-level
  `pushSecrets[].conversionStrategy` is rendered.
- **One pull target per claim.** Because all pulled keys share a single
  `ExternalSecret`, they share one target Secret named after the claim.

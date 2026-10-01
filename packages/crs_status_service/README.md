# crs_status_service

Read-side HTTP service that serves live status projections of firestartr Custom Resources to Backstage.

Uses Kubernetes informers to watch CRs and maintain an in-memory cache. When a CR is deleted, a tombstone entry is retained until a configurable TTL.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CRS_STATUS_KIND_LIST` | yes | — | Comma-separated list of CR plural kinds to watch |
| `CRS_STATUS_NAMESPACE` | yes | — | Kubernetes namespace to watch |
| `CRS_STATUS_PORT` | no | `9091` | HTTP server port |
| `CRS_STATUS_API_GROUP` | no | `firestartr.dev` | CR API group |
| `CRS_STATUS_API_VERSION` | no | `v1` | CR API version |
| `CRS_STATUS_TOMBSTONE_TTL` | no | `3600000` | Tombstone TTL in ms |

## API

### `GET /status`

Returns a status projection per watched CR.

Response shape (array of [StatusProjection](#statusprojection)):

```json
[
  {
    "kind": "FirestartrTerraformWorkspace",
    "name": "my-workspace",
    "namespace": "default",
    "claimKind": "ComponentClaim",
    "claimName": "my-component",
    "phase": "SYNCHRONIZED",
    "conditions": [
      {
        "type": "Sync",
        "status": "True",
        "reason": "ReconcileSuccess",
        "message": "Reconciled successfully",
        "lastTransitionTime": "2025-01-01T00:00:00.000Z"
      }
    ],
    "observedAt": "2025-01-01T00:00:00.000Z"
  }
]
```

Tombstone entries have `phase: "DELETED"` and reflect the last-known state before deletion. They are retained for up to `CRS_STATUS_TOMBSTONE_TTL` ms (default 3600000).

## Build

```sh
npm run build
```

Outputs a single bundled JS file to `dist/` via `ncc`.

## License

ISC

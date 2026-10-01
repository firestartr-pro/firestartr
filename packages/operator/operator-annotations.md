# Operator Annotations

Operator metadata keys use the `firestartr.dev/` prefix and are typically constructed using the `getFirestartrAnnotation()` helper from `catalog_common`. The entries below include annotations, labels, and finalizers used by the operator.

| Annotation | Purpose |
|---|---|
| `firestartr.dev/claim-ref` | Links a CR back to its originating claim. Format: `ClaimKind/claim_name`. |
| `firestartr.dev/external-name` | Stores the external (human-readable) name of the managed resource. |
| `firestartr.dev/revision` | Tracks the revision number of a CR, incremented on each update by the `RevisionNormalizer`. |
| `firestartr.dev/last-state-pr` | Records the PR reference (`owner/repo#prNumber`) of the last state PR that reconciled this CR. Used for user feedback. |
| `firestartr.dev/pull-request-plan` | Records the PR reference for a Terraform plan operation. Used for posting plan results back to PRs. |
| `firestartr.dev/policy` | Defines the reconciliation policy for a Terraform workspace CR (e.g., `observe`, `apply`). |
| `firestartr.dev/bootstrapped` | Boolean flag (`"true"`) defines if this resource has been created throught the bootstrap process. |

### Sync and Reconciliation Annotations

| Annotation | Purpose |
|---|---|
| `firestartr.dev/sync-policy` | Defines the reconciliation policy used specifically during sync operations. |
| `firestartr.dev/sync-enabled` | Boolean flag (`"true"`) enabling automatic periodic sync for a CR. |
| `firestartr.dev/sync-period` | Specifies the sync interval (e.g., `24h`, `1m`) for periodic reconciliation. |
| `firestartr.dev/sync-schedule` | Cron expression for scheduled sync (alternative to `sync-period`). |
| `firestartr.dev/sync-schedule-timezone` | Timezone for the sync schedule cron expression. Defaults to `Europe/Madrid`. |


### Operator internal annotations (automatically managed by the operator, not for user manipulation)

| Annotation | Purpose |
|---|---|
| `firestartr.dev/finalizer` | Kubernetes finalizer ensuring cleanup logic runs before CR deletion. |
| `firestartr.dev/foreground-deletion` | Signals foreground deletion for ownership and cleanup handling. |
| `firestartr.dev/old-name` | Tracks the previous name of a CR after a rename, so the operator can clean up the old resource. |


### Operator behavior control annotations

| Annotation | Purpose |
|---|---|
| `firestartr.dev/import` | Boolean flag (`"true"`) marking a CR for Terraform state import of an existing resource. |
| `firestartr.dev/needs-re-import` | Boolean flag (`"true"`) to force re-import by removing and re-importing Terraform state. Destructive operation. |
| `firestartr.dev/reconcile-at` | ISO date annotation to trigger reconciliation at a specific time. |
| `firestartr.dev/feature-name` | Stores the name of the repository feature (e.g., branch protection) that a CR represents. |
| `firestartr.dev/github-id` | Stores the GitHub numeric ID of an imported resource (e.g., team ID). |
| `firestartr.dev/github-slug` | Stores the GitHub slug of a team or group. |


### Operator debug and testing annotations

| Annotation | Purpose |
|---|---|
| `firestartr.dev/gh-debug` | Enables debug mode for the GitHub provisioner on a specific CR. |
| `firestartr.dev/gh-tfm` | Short-lived override annotation to specify a custom Terraform module URL (escape hatch for testing). |
| `firestartr.dev/terraform-module` | Specifies a custom Terraform module source for provisioning a CR. |

### Legacy Annotations (`fire-starter.dev` prefix)

| Annotation | Purpose |
|---|---|
| `fire-starter.dev/uuid` | Unique identifier (UUID v4) assigned to catalog artifacts for storage key generation. |
| `fire-starter.dev/timestamp` | Write timestamp added when serializing catalog artifacts. |

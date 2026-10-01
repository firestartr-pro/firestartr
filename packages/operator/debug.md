# Debug files

The operator writes three debug files to `/tmp` that reflect the internal state of the work queue, sync watchers, and the full operator snapshot in real time. The first two are always active; `/tmp/diagnostic` is active by default but can be disabled via `DISABLE_DIAGNOSTIC_FILE`.

## `/tmp/queue`

**Source:** `src/processItem.debug.ts`

**Trigger:** Written every **5 seconds** via `setInterval`. Starts automatically when the first work item is processed.

**Format:** One line per work item in the queue:

```
<kind>/<name> - <workStatus> (slot:<slotId>) - <operation> [BLOCKED] - (upsert <elapsed>)
```

| Field | Description | Possible values |
|---|---|---|
| `kind/name` | Kubernetes resource kind and `metadata.name` | Any valid K8s kind/name |
| `workStatus` | Current processing state | `PENDING`, `PROCESSING`, `FINISHED` |
| `(slot:N)` | Assigned processing slot (omitted if unassigned) | Integer |
| `operation` | Type of operation that triggered the work item | `RENAMED`, `UPDATED`, `CREATED`, `SYNC`, `MARKED_TO_DELETION`, `NOTHING`, `RETRY` |
| `[BLOCKED]` | Present only if the work item is blocked by an external condition | - |
| `(upsert ...)` | Time elapsed since the item was enqueued/updated | e.g. `2 hours, 15 minutes ago`, `Just now` |

**Example:**

```
ClaimRelease/my-release - PENDING  - CREATED  - (upsert 3 minutes, 12 seconds ago)
ClaimRelease/other-release - PROCESSING (slot:0) - SYNC  - (upsert 1 hour, 5 minutes ago)
ClaimRelease/old-release - PENDING  - MARKED_TO_DELETION [BLOCKED] - (upsert 2 days, 3 hours ago)
```

## `/tmp/syncs`

**Source:** `src/syncer.debug.ts`

**Trigger:** Written every time a sync watcher is **added**, **updated**, or **deleted** (called from `syncer.ts`). A concurrency guard with a 300ms deferred retry prevents overlapping writes.

**Format:** One line per sync watcher:

```
<itemPath> - (<syncMode>) - next: <nextSync>
```

| Field | Description | Possible values |
|---|---|---|
| `itemPath` | Path identifying the watched resource | String |
| `syncMode` | How the sync is configured | `Scheduled`, `Period`, `NotSyncable` |
| `nextSync` | Timestamp of the next planned synchronization | Date string or empty |

**Example:**

```
default/my-release - (Period) - next: 2026-04-14T12:30:00.000Z
default/other-release - (Scheduled) - next: 2026-04-14T13:00:00.000Z
default/static-release - (NotSyncable) - next: undefined
```

## `/tmp/diagnostic`

**Source:** `src/processItem.diagnostic.ts`

**Trigger:** Written every **10 seconds** via `setInterval`. Starts automatically when the processor loop starts (`loop()` in `processItem.ts`).

**Disable:** Set `DISABLE_DIAGNOSTIC_FILE=1` in the operator environment.

**Format:** YAML snapshot of operator state:

```yaml
timestamp: "<ISO 8601>"
env:
  OPERATOR_NUMBER_OF_MAX_SLOTS: <number>
  OPERATOR_MAX_CONCURRENT_API_CALLS: <number>
  OPERATOR_KIND_LIST: <string>
  TFM_MIRROR_DISABLE: <0|1>
  TFM_MIRROR_LIST: <string>
  TFM_MIRROR_REFRESH_INTERVAL: <seconds>
  TFM_SKIP_GIT_CONFIG: <true|false>
  BACKEND_PROVIDER_NAME: <string>
  GITHUB_APP_ID: <string>
queue:
  total: <number>
  pending: <number>
  processing: <number>
  finished: <number>
  blocked: <number>
  dead_letter: <number>
slots:
  max: <number>
  active: <number>
  items_per_slot:
    slot-0: "<kind>/<name>" | null
    slot-1: "<kind>/<name>" | null
    ...
semaphore:
  max: <number>
  in_use: <number>
  available: <number>
  pending: <number>
  peak: <number>
  total_acquisitions: <number>
  times_saturated: <number>
errors:
  total: <number>
```

| Section | Field | Description |
|---|---|---|
| `env` | — | Curated set of operator env vars at snapshot time. Grows over time as new diagnostic needs arise. |
| `queue` | `total` | Total work items in the queue |
| | `pending` | Items waiting for a free slot |
| | `processing` | Items currently being processed |
| | `finished` | Items completed but not yet garbage-collected |
| | `blocked` | Items blocked by `isBlocked` flag |
| | `dead_letter` | Items in Dead-Letter Handler state |
| `slots` | `max` | `OPERATOR_NUMBER_OF_MAX_SLOTS` |
| | `active` | Number of slots currently processing (same as `queue.processing`) |
| | `items_per_slot` | Which CR each slot is processing; `null` when idle |
| `semaphore` | `max` | Semaphore capacity (`OPERATOR_MAX_CONCURRENT_API_CALLS`) |
| | `in_use` | Current concurrent API calls |
| | `available` | Remaining capacity |
| | `pending` | Acquires waiting for a release |
| | `peak` | Highest concurrent API calls seen since operator start |
| | `total_acquisitions` | Cumulative acquire count since operator start |
| | `times_saturated` | How many times `acquire()` had to queue (bottleneck indicator) |
| `errors` | `total` | Cumulative terminal errors sent to DLH since operator start |

**Example:**

```yaml
timestamp: "2026-07-16T10:00:30Z"
env:
  OPERATOR_NUMBER_OF_MAX_SLOTS: 5
  OPERATOR_MAX_CONCURRENT_API_CALLS: 5
  OPERATOR_KIND_LIST: "DummyCR,ClaimRelease"
  TFM_MIRROR_DISABLE: "0"
  TFM_MIRROR_LIST: ""
  TFM_MIRROR_REFRESH_INTERVAL: "900"
  BACKEND_PROVIDER_NAME: "kubernetes-provider"
  GITHUB_APP_ID: "123456"
queue:
  total: 100
  pending: 45
  processing: 5
  finished: 48
  blocked: 2
  dead_letter: 0
slots:
  max: 5
  active: 5
  items_per_slot:
    slot-0: "DummyCR/foo-12"
    slot-1: "DummyCR/foo-7"
    slot-2: null
    slot-3: "DummyCR/foo-55"
    slot-4: "DummyCR/foo-3"
semaphore:
  max: 5
  in_use: 3
  available: 2
  pending: 0
  peak: 5
  total_acquisitions: 312
  times_saturated: 4
errors:
  total: 2
```

## `/tmp/activity.log`

**Source:** `src/activity-log.ts`

**Enable:** Set `ACTIVITY_LOG=/tmp/activity.log` (or any path) in the operator environment. Disabled by default — zero overhead when unset.

**Trigger:** Written every time a CR changes via the Kubernetes informer watch. Fires at two levels:

- **Reflector** (`reflector.ts`) — raw Kubernetes watch events: `UPDATE`, `DELETE`
- **Informer** (`informer.ts`) — semantic operations after store filtering: `ADD`, `MODIFY`, `DELETE`, `RENAME`

A single CR change may produce two lines (one reflector, one informer). This is intentional — the reflector line shows what Kubernetes saw, the informer line shows what the operator decided to do about it.

**Rotation:** File is truncated to its second half when it exceeds 2 MiB.

**Format:** One line per event:

```
<timestamp>  <event>    <kind>  <name>  ns=<namespace> rv=<resourceVersion>
```

| Field | Description |
|---|---|
| `timestamp` | ISO 8601 UTC |
| `event` | `ADD`, `MODIFY`, `DELETE`, `RENAME` (informer) or `UPDATE`, `DELETE` (reflector) |
| `kind` | Kubernetes resource kind (e.g. `FirestartrTerraformWorkspace`) |
| `name` | `metadata.name` of the CR |
| `ns` | Namespace |
| `rv` | `metadata.resourceVersion` — useful for spotting missed or duplicate watch events |

**Example:**

```
2026-08-17T10:23:45.123Z  ADD       FirestartrTerraformWorkspace  my-app      ns=default rv=12345
2026-08-17T10:23:45.200Z  ADD       FirestartrTerraformWorkspace  my-app      ns=default rv=12345
2026-08-17T10:24:01.789Z  UPDATE    FirestartrGithubRepository    my-repo     ns=default rv=12346
2026-08-17T10:24:01.810Z  MODIFY    FirestartrGithubRepository    my-repo     ns=default rv=12346
2026-08-17T10:25:00.000Z  DELETE    FirestartrTerraformWorkspace  my-app-old  ns=default rv=12347
2026-08-17T10:25:00.050Z  DELETE    FirestartrTerraformWorkspace  my-app-old  ns=default rv=12347
```

**Use cases:**

- Spot CRs that change but never get processed (reflector line present, no informer line)
- Debug informer reconnection — a burst of `UPDATE` lines with sequential `rv` values means the watch re-listed cleanly
- Trace the exact order of CR changes during an incident

## Usage

From inside the operator pod:

```sh
# Watch the queue in real time
watch cat /tmp/queue

# Watch the sync watchers
watch cat /tmp/syncs

# Watch the diagnostic snapshot (updates every 10s)
watch cat /tmp/diagnostic

# Watch the activity log (requires ACTIVITY_LOG env)
tail -f /tmp/activity.log
```

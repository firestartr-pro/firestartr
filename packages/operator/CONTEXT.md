# operator

The pure actuator: watches Firestartr Custom Resources and runs a slot-based
weighted queue of reconciliation work. This glossary covers the core machinery,
status, scheduling, and dev-test vocabulary; other areas are authored lazily via
`/domain-modeling` as the package is touched.

## Core machinery

**Work item**:
One unit of reconciliation work for a single CR, carrying an operation type; the
thing the queue holds.
_Avoid_: job, task, event

**Operation type**:
The reconciliation intent of a work item: `CREATED`, `UPDATED`, `RENAMED`,
`MARKED_TO_DELETION`, `RETRY`, `SYNC`.
_Avoid_: action, verb

**Slot**:
One concurrent processing lane, bounded by `OPERATOR_NUMBER_OF_MAX_SLOTS`.
_Avoid_: worker, thread

**Informer**:
Watches Kubernetes events and translates them into work items.
_Avoid_: watcher, listener

**Processor**:
The `processItem` family that executes a work item.
_Avoid_: handler, reconciler

**Weighted queue**:
Queue ordering by operation weight first, then `upsertTime`.
_Avoid_: priority queue

**Syncer**:
Periodic machinery that re-enqueues existing CRs to reconcile drift without an
external event.
_Avoid_: poller

**DLH (Dead-Letter Handler)**:
The "Uncontrolled error (DLH)" terminal failure path for a work item.
_Avoid_: dead letter queue

## Status & lifecycle

**High-priority status**:
The single dominant CR state, collapsed from its conditions by a fixed priority
order (`ERROR` wins) and persisted as `status.highPriorityState` /
`status.highPriorityReason`. `UNKNOWN` when no condition is yet `True`.
_Avoid_: main status, top condition

**TFResult**:
The CRD persisting a Terraform operation's outcome and `retryCount`.
_Avoid_: tf output, result CR

**Foreground-deletion finalizer**:
`firestartr.dev/foreground-deletion`, installed on a parent to block its deletion
until its children are gone.
_Avoid_: owner ref, blocker

## Scheduling refinements

**Block counter**:
In-memory per-identity counter of blocked-deletion attempts, independent of the
retry subsystem.
_Avoid_: penalty, strike

**Deferred blocked item**:
A blocked parent deletion past 5 attempts, scheduled behind all non-deferred
work in a stable segment.
_Avoid_: demoted item, backlog item

**Parent-identity check**:
`hasActiveParent`: blocks a CREATED child from dispatch while its specific parent
is still pending or processing.
_Avoid_: dependency guard

## PR planning

**PR head resource**:
A CR loaded from the pull request head ref.
_Avoid_: current CR, incoming CR

**Base resource**:
A CR loaded from the pull request base SHA (`baseSha`), i.e. the state being
changed.
_Avoid_: previous CR, old CR

**Deleted file**:
A PR file whose status is `FileStatus.DELETED`, the operator enum value for
GitHub's file status string `'removed'`.
_Avoid_: removed file, gone CR

**Plan-destroy**:
The destroy plan run for a deleted child CR; resolves its deleted parent from the
base resource rather than the head ref.
_Avoid_: delete plan, teardown plan

## Terraform workspaces

**Session-scoped workspace**:
The per-execution local Terraform project directory, isolated by a random
session id (`/tmp/tfworkspaces/<kind>-<name>-<sessionId>`), so overlapping runs
for the same CR never share or destroy each other's local files. Distinct from
the **backend state**, which session isolation never touches.
_Avoid_: temp dir, scratch workspace

**Workspace reuse**:
Reusing one prepared session-scoped workspace across the follow-up Terraform
commands of an operation (the `output` after `apply`) instead of rebuilding and
re-initialising the project per command (`reuseExistingProject`).
_Avoid_: caching, warm workspace

**Tear-up**:
Removing the session-scoped workspace at the end of an operation
(`tear-up-project`); best-effort and never fatal. Distinct from a Terraform
`destroy`, which removes provisioned resources.
_Avoid_: tear-down, cleanup, teardown

## User feedback

**Apply progress comment**:
The single sticky PR comment on the wet-repo PR for one CR operation (apply or
destroy): it announces that processing has started (with a link to the check
run) and is updated in place with the final result when the operation ends.
Keyed per resource.
_Avoid_: hydration message, check-run comment

## Dev-test

**Dummy CRs**:
Side-effect-free CRs (`fsdummiesa/b/c`) that exercise core machinery without
touching real providers.
_Avoid_: fakes, test CRs

**Dev pod**:
The in-cluster `firestartr-dev` deployment with the repo mounted at `/library`,
where the operator runs for local dev.
_Avoid_: dev container

## Diagnostics & observability

**Diagnostic file**:
`/tmp/diagnostic`: a YAML snapshot of operator state (queue, slots, semaphore, error count) overwritten every 10 seconds. Always active by default; opt-out via `DISABLE_DIAGNOSTIC_FILE`.
_Avoid_: flight recorder, diagnosis file

**Diagnostic error count**:
A cumulative, increment-only counter of terminal errors sent to the DLH, exposed as `errors.total` in the diagnostic file. Never reset during the operator lifetime.
_Avoid_: error tally, failure count

**Semaphore saturation**:
A counter of how many times the API-read semaphore's `acquire()` had to wait because all permits were taken. Exposed as `semaphore.times_saturated`. A high count relative to `total_acquisitions` indicates a concurrency bottleneck.
_Avoid_: semaphore pressure, throttle count

> Auth uses **Profile** / `withProfile('operator')` — defined in the `github`
> context, referenced here.

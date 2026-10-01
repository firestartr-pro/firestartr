# Policy-aware retry dispatch: RETRY_SYNC and error-condition gating

The retry subsystem previously dispatched every retry through the same `doApply`
path, regardless of why the item failed. A SYNC (plan-only/observe) failure would
set `SYNCHRONIZED=True` without an `ERROR` condition, suppressing retry entirely.
This meant a transient SYNC failure was silently swallowed with no retry.

## Decision

Introduce a `RETRY_SYNC` operation type and reason-based dispatch:

1. **`retryOpForReason`** — maps an `ERROR` condition reason to either `RETRY` or
   `RETRY_SYNC`. When the reason is `SYNC` or `RETRY_SYNC`, the enqueued operation
   is `RETRY_SYNC`; everything else maps to `RETRY`.

2. **`retry()` dispatches on the enqueued operation, not the current condition.**
   If `op === RETRY_SYNC`, the retry always routes to `sync()` (which honours
   `sync-policy`). If `op === RETRY`, it routes to `doApply()`. This avoids a
   TOCTOU race where the ERROR condition could clear between enqueue and
   processing, causing `doApply()` to run with `RETRY_SYNC` — violating the
   "observe retries must never apply" guarantee.

3. **`doPlanJSONFormat` sets `ERROR=True` on SYNC failure only when an explicit
   sync-policy is set.** When `sync-policy` is unset (the legacy default), errors
   still produce `SYNCHRONIZED=True` and no `ERROR` condition, preserving
   pre-`#2277` behaviour. User story 13 required that the unset/default path be
   unchanged.

4. **`policyAllowsOp` applies the same `deletionTimestamp` guard to `RETRY_SYNC`
   as it does to `RETRY`.** Without this guard, a resource under an observe policy
   (which allows `SYNC` but not deletion) could be destroyed if a `RETRY_SYNC`
   work item was enqueued while `deletionTimestamp` was present — the `retry()`
   function routes deletionTimestamp items to `markedToDeletion()`.

## Consequences

- SYNC failures under an explicit `sync-policy: observe` now produce `ERROR=True`
  and retry via `RETRY_SYNC`, where previously they were silently suppressed.
- The unset/default `sync-policy` path is unchanged — no `ERROR` condition, no
  retry.
- The dispatch path is deterministic from enqueue time: `op` is authoritative,
  not a re-read of live conditions.
- `policyAllowsOp` blocks `RETRY_SYNC` on deleting resources under non-full-
  control policies, preventing accidental destruction.
- New unit tests cover `retryOpForReason` for all expected input categories.

Supersedes any prior ADR that described retry behaviour without the `RETRY_SYNC`
distinction.

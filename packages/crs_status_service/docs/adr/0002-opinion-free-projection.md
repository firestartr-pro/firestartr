# The projection is opinion-free: minimal fields, no editorial convenience fields

The status projection avoids derived "meaning" fields like `healthy`, `driftPlan`,
or `errorMessage`. It reports `phase` (derived deterministically from the CR's
conditions using the operator's priority order) plus the raw `conditions` array;
consumers translate.

## Context

The PRD's projection included a derived `healthy: boolean` and convenience fields
`driftPlan` (from the `LAST_PLAN_DETAILS` condition) and `errorMessage` (from the
`ERROR` condition). Each is a place where the service reaches into conditions and
editorialises; this ADR keeps the projection minimal and leaves interpretation to
consumers.

## Decision

Drop `healthy`, `driftPlan`, and `errorMessage`. The projection exposes `phase`
plus the verbatim `conditions` array (and identity/claim-ref/`observedAt`
metadata). Backstage extracts `LAST_PLAN_DETAILS` / `ERROR` messages itself — a
one-liner against `conditions`. In particular `OUT_OF_SYNC` stays a distinct
first-class `phase` value, not folded into a generic unhealthy bucket.

## Consequences

- The contract stays minimal and opinion-free; nothing to drift when condition
  semantics change. Backstage owns the phase→colour and condition→message mapping.
- No ambiguity to resolve for transient (`PROVISIONING`/`PLANNING`/`DELETING`) or
  `UNKNOWN` phases — there is no boolean to force them into.
- Every consumer re-implements the (trivial) condition-message extraction; this is
  accepted as the cost of a stable, un-opinionated contract.

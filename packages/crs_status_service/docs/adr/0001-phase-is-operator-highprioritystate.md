# Phase is derived from conditions using the operator's priority order

The read-side status service reports each CR's `phase` by deriving it from the CR's
raw `status.conditions` using the same fixed priority order as
`packages/operator/src/high_priority_status.ts`.

## Context

Three places in the repo collapse a CR's conditions into a single state, and they
do not all agree: `crs_analyzer`'s `Cr` model (only `OUT_OF_SYNC`/`ERROR`),
`operator/src/metrics/CRStates.ts` ("first `True` non-`SYNCHRONIZED`" rule), and
`operator/src/high_priority_status.ts` (a fixed priority order, persisted as
`status.highPriorityState`). The original PRD said to "reuse the `Cr` model", but
that model produces neither a full phase nor the same answer as the operator.

## Decision

`phase` = `derivePhase(status.conditions)`, where `derivePhase` mirrors the
operator's `high_priority_status.ts` priority list.

## Consequences

- The public `phase` domain is the operator's full set — `ERROR`, `PROVISIONING`,
  `OUT_OF_SYNC`, `PLANNING`, `DELETING`, `SYNCHRONIZED`, `PROVISIONED`, `DELETED`,
  plus `UNKNOWN` (no condition yet `True`, e.g. a just-created CR). This is wider
  than the PRD's `PROVISIONED | PROVISIONING | OUT_OF_SYNC | ERROR | PLANNING |
  DELETED`; the PRD enum is superseded by this.
- `SYNCHRONIZED` is the steady healthy state; consumers must treat it as healthy.
- The service is coupled to the operator's status vocabulary. A renamed or removed
  operator state changes this contract — acceptable, because matching the operator
  is the whole point.

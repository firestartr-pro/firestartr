# crs_status_service

The read-side service that serves the live status of firestartr Custom Resources
to Backstage. This glossary is authored lazily via `/domain-modeling` as the
package is designed and built.

## Language

**Phase**:
The single collapsed state the service reports for a CR. It is derived from the
CR's `status.conditions` using the same fixed priority order as
`packages/operator/src/high_priority_status.ts` (domain: `ERROR`, `PROVISIONING`,
`OUT_OF_SYNC`, `PLANNING`, `DELETING`, `SYNCHRONIZED`, `PROVISIONED`, `DELETED`, `UNKNOWN`).
_Avoid_: state, status, condition

**Status projection**:
The curated, stable per-CR shape the service returns, distinct from the raw CR
it is derived from.
_Avoid_: status DTO, view, snapshot

**Claim-ref**:
The `kind/name` join key (`firestartr.dev/claim-ref` annotation) that ties a CR
back to the Backstage entity it backs; the service's primary lookup key.
_Avoid_: owner, entity ref, claim id

**Tombstone**:
The retained last-known projection of a CR the informer has dropped (gone from
the cluster), kept so `DELETED` stays queryable until its TTL expires.
_Avoid_: ghost, deleted entry

> **Phase** is the operator's **High-priority status** — defined in the
> `operator` context, referenced here.

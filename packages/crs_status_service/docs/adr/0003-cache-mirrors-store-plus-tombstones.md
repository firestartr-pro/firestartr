# Cache mirrors the informer store, plus TTL-evicted `DELETED` tombstones

The in-memory status cache tracks the informer store one-to-one for live CRs, and
additionally retains a tombstone for each deleted CR for a configured TTL so that
`phase: DELETED` stays queryable.

## Context

The watch layer drops an object from its store the moment it leaves the cluster.
A pure store-mirror could therefore never reliably serve `phase: DELETED` — by
query time the object is gone and the answer would be 404. But consumers need all
states, including `DELETED`, and the service must stay opinion-free: it keeps the
state and lets the querier translate (e.g. hide deleted entities). See ADR-0001
(verbatim phase) and ADR-0002 (opinion-free projection).

## Decision

On a `delete` event, retain the CR's last projection as a tombstone for
`TOMBSTONE_TTL` (configurable via env, default ~1h), then evict it (subsequent
lookups 404). A live `add`/`update` for the same key supersedes the tombstone
immediately, so a recreated claim-ref never reads stale `DELETED`.

## Consequences

- Memory and staleness are both bounded by the TTL; no unbounded growth in a
  long-running daemon.
- `DELETED` is a best-effort, time-boxed read window — guaranteed for the TTL
  after deletion, not forever.
- After an informer resync the live set self-heals from the API server;
  tombstones are managed separately on their own TTL clock.

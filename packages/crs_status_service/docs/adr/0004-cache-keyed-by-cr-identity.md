# Cache keyed by CR identity; claim-ref is a secondary index

The status cache is keyed by **CR identity** (`kind` + `name` within the watched
namespace). The `firestartr.dev/claim-ref` lookup is a **secondary index**
mapping `claimKind/claimName → [CR identities]`, layered over that primary key.

## Context

The primary read path is entity-centric (look up the CRs backing a Backstage
entity by claim-ref). But not every watched CR carries a claim-ref, and we
foresee querying CRs by their own identity — list a kind, or fetch one CR by
`kind` + `name`. Keying the cache on claim-ref would make claim-less CRs
unaddressable and the future identity lookups awkward.

## Decision

Key the cache on CR identity; build the claim-ref index as a secondary structure.
A claim-ref lookup returns an **array** of projections (possibly empty). CRs
without a claim-ref are still cached and still appear in the namespace-wide list;
they are simply absent from the claim-ref index.

## Consequences

- No CR is dropped for lacking a claim-ref; the overview list stays complete.
- Future `GET /status/kind/:kind` and `GET /status/cr/:kind/:name` are cheap
  additions over the same primary key — **deferred, out of scope for now**.
- The claim-ref index must be maintained alongside the primary cache on every
  add/update/delete (and tombstone eviction).

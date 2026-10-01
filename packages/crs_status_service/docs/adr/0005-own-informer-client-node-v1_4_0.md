# Own thin informer on `@kubernetes/client-node` v1.4.0

`crs_status_service` builds its own minimal informer wrapper directly on
`@kubernetes/client-node`, pinned to **v1.4.0**, rather than importing the
operator's `reflector.ts` or sharing the repo's `0.22.3` client.

## Context

The service's reason to exist is isolation from the operator (PRD Decisions 2 &
4): Backstage read-traffic must never touch the reconcile process. Importing
`operator/src/reflector.ts` would drag a compile/runtime dependency on the entire
operator package — and re-trip the operator validation gate — undoing that
isolation. The watch itself is ~40 lines (list+watch per plural, events → cache,
reconnect-on-error).

## Decision

Own a thin informer in this package. Pin `@kubernetes/client-node` to `1.4.0`,
diverging from the repo-wide `0.22.3` used by `operator`, `crs_analyzer`, and
`e2e`.

## Consequences

- Real code-level isolation from `operator`; no shared-machinery coupling.
- The informer/watch API differs between `0.x` and `1.x`, so `reflector.ts`
  **cannot** be copied verbatim — the wrapper is written against the `1.4.0` API.
- This package intentionally does not match the repo's client version. Aligning it
  to `0.22.3`, or bumping the others to `1.4.0`, is a separate deliberate change —
  not a drive-by "consistency" fix.
- A shared `k8s-informer` lib (the third option) is deferred as premature for ~40
  lines today.

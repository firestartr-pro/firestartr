# Launched as a CLI subcommand, co-bundled with the operator

`crs_status_service` is launched through the universal `cli` package as a
`crs-status` subcommand calling its exported `runService()`, exactly like the
operator's `runOperator()` — not shipped as its own standalone image.

## Context

The `cli` package is the repo's single launcher: every firestartr process,
daemons included, runs as one `firestartr-cli <subcommand>` invocation, and the
operator (also a long-running daemon) proves daemons belong there. A new
firestartr process therefore joins the CLI by default; staying out needs
justification.

ADR-0005 demands isolation from the operator, which raised the question of
whether CLI membership violates it. It does not: as a sibling subcommand,
`crs_status_service` has no import edge to `operator` (the specific coupling
ADR-0005 forbids), keeps its own `@kubernetes/client-node@1.4.0` pin in its own
`package.json`, and runs in its own pod — so runtime isolation ("Backstage
read-traffic never touches the reconcile process") is delivered by separate
pods, not separate images.

## Decision

Wire `crs_status_service` into `cli` as the `crs-status` subcommand. ADR-0005's
"no shared-machinery coupling" is read narrowly as "no direct dependency on
`operator`", which co-bundling preserves.

## Consequences

- The single `ncc` CLI bundle carries two `@kubernetes/client-node` major
  versions (`0.22.3` for operator, `1.4.0` here). `ncc` bundles both via their
  distinct resolved paths; the cost is a larger bundle, accepted in exchange for
  launch/packaging uniformity.
- Launch uniformity: one image, one entrypoint, per-pod subcommand selection.
- If the dual-version bundle ever becomes untenable, the fallback is a deliberate
  CLI exception (own image) — reversing this ADR, not ADR-0005.

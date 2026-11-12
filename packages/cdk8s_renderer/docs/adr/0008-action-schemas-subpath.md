# ADR 0008: Publish action schemas as a separate view

Status: Accepted

## Context

Issue #199 brings five dispatch-action schemas into the TypeScript source of
truth established by [ADR 0007](0007-unified-dot-firestartr-schemas.md) (#185).
Three describe the same organization data.

## Decision

Keep `src/schemas/dot-firestartr/` and add `src/schemas/actions/`. The action map
reuses canonical apps, platforms and registry objects and defines only config
and build results. Both registry consumers import one host rule from
`src/schemas/registry-host.ts`.

Publish through `actions` and `actions/*` in the same npm artifact, not as
claims. Both views follow the npm-only delivery in ADR 0007. Strip action `$id`
values to avoid collisions when both views compile together; retain descriptive
metadata and the six-value authentication enum. Anchor the version grammar once
and match the action ref helper rather than unsupported magic forms.
See [compatibility details](../actions-schemas.md).

## Consequences

One definition serves both views with explicit publication metadata handling.
Equality to the originals is semantic, with approved enum and version changes,
not byte-for-byte. Action-repository migration is out of scope.

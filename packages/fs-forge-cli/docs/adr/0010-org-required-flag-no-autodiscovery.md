# ADR 0010: `--org` is a required flag for preflight, not autodiscovered

## Status
Accepted

## Context

The preflight command needs to know which GitHub organization to check. Other
CLI commands (`edit`, `delete`) autodiscover the org from
`FSCRT_ORG` or default to reading `.firestartr/` config. Preflight is
different: it queries the provider API for resources that exist independently
of any local claims checkout.

## Decision

`--org` must be passed explicitly. `FSCRT_ORG` is also accepted as a fallback
to match the convention used by other commands, but the command does not read
`.firestartr/` config or git remotes to infer the org.

## Alternatives considered

### Autodiscovery from git remote or `.firestartr/config`
A user can validly run preflight from outside a claims repo — they might be
checking if a name is available before even cloning. Autodiscovery would
fail or produce wrong results in that context.

### `FIRESTARTR_ORG` env var fallback
This is already supported via `FSCRT_ORG` (matching other commands). A
separate env var just for preflight would add inconsistency.

## Consequences

- One extra required flag vs. zero-click ergonomics.
- Easily reversible if user feedback demands autodiscovery.
- Consistent with ADR 0008: the command is self-contained.

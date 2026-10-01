# ADR 0008: Preflight as a top-level command, not a subcommand

## Status
Accepted

## Context

Before creating, editing, or deleting a claim, users need to check for name
collisions — both in the local claims system and at the provider API (GitHub).
This "preflight" check must be composable in scripts and fast (sub-second
when scope is `claims`-only).

## Decision

`firestartr preflight` is a standalone top-level command, not nested under
`firestartr validate preflight` or `firestartr create --preflight`.

## Alternatives considered

### Subcommand of `validate`
`validate` checks claim schema conformance against JSON Schema. Preflight
reaches the provider API to check resource existence — a fundamentally
different operation. Rejected to keep `validate` focused.

### Flag on `create`/`edit`/`delete`
Tucking preflight under mutation commands would couple it to mutation flows
and make it undiscoverable for human ad-hoc use. Scripts that gate mutations
with `&&` chaining (`preflight && create`) would not be possible. Rejected.

## Consequences

- Top-level command surface grows by one entry.
- Hard to reverse if the command taxonomy later consolidates.
- `--org` is a required flag (see ADR 0010), making the command self-contained
  even when run outside a claims repo checkout.

# ADR 0009: CLI owns provider checks directly via ClaimsClient, not via the operator

## Status
Accepted

## Context

The preflight command must confirm whether a resource already exists at the
provider (e.g., a GitHub repository, team, or org member). Two alternatives
exist for querying this: ask the operator (which manages the resource's
lifecycle) or call the provider API directly.

## Decision

The CLI calls Octokit APIs directly for provider-side existence checks via
new methods on the GitHub port (`repoExists`, `teamExists`,
`userIsOrgMember`). It does not delegate to the operator via CRD status
queries or GitHub Actions dispatch.

## Alternatives considered

### kubectl exec into operator and query its internal state
The operator is an eventual-consistency reconcile loop, not a synchronous
query interface. Its in-memory state may be stale relative to the provider.

### Dispatch a workflow and poll for result
A workflow dispatch adds unacceptable latency (tens of seconds) for a CLI
command that should return in under a second.

## Consequences

- The GitHub port grows a provider-check surface beyond claim CRUD.
- Token scopes must include `read:org` (for membership checks) and repo read
  (for repository existence checks).
- `TFWorkspace` remains claims-only for now since no TFC API client exists yet.
- Provider check methods use the same `Octokit` instance and `GITHUB_TOKEN`
  already required by the GitHub port.

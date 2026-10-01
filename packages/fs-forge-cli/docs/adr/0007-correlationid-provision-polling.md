# ADR 0007: Correlation-ID-based provision workflow polling

## Status
Accepted

## Context

When `fs-forge` commits a claim (`--commit`), it dispatches the claims repo's
`provision-claim.yaml` workflow via `workflow_dispatch`. The GitHub REST API's
`createWorkflowDispatch` endpoint returns `204 No Content` — no run ID. To
implement synchronous `waitForProvision` (issue #2486), the CLI needs to locate
the specific run it just dispatched.

## Decision

Pass a UUID `correlationId` as a `workflow_dispatch` input, and find the
corresponding run by its `display_title`. The claims repo's
`provision-claim.yaml` already accepts `correlationId` and uses it as the
`run-name`:

```yaml
run-name: ${{ inputs.correlationId != '' && inputs.correlationId || format('provision {0}/{1}', inputs.claimType, inputs.claimName) }}
```

After dispatch, the CLI polls
`GET /repos/:owner/:repo/actions/workflows/<workflow_id>/runs` (filtered by
`branch=<dispatch-branch>` and `event=workflow_dispatch`) and matches
`display_title === correlationId`.

The dispatch branch is critical: `publishClaim` dispatches on
`fs-forge/<Kind>-<name>`, not the default branch. The polling must filter by
the same branch — using the default branch would return zero results because
the run's `head_branch` is the feature branch. The dispatch branch is carried
in `WorkflowDispatchResult.branch` and forwarded to `waitForWorkflow`.

## Alternatives considered

### Branch-based run discovery
Dispatch on a unique branch (`fs-forge/<Kind>-<name>`) and query the latest
run on that branch. Rejected because the provision workflow creates a PR and
merges it; the run may shift reference off the original branch after merge,
making branch-based lookup unreliable.

### Commit-SHA-based run discovery
Query runs by `head_sha` of the commit pushed by `publishClaim`. Rejected
because the workflow dispatch triggers a new checkout that may reference a
different SHA (especially after the PR merge step), making SHA-based lookup
fragile.

### Polling for artifact availability
Wait for the `provision-result` artifact to appear. Rejected because artifact
download adds latency and complexity; a run ID must still be obtained first.

## Consequences

- **No changes needed to the claims repo** — `correlationId` is already a
  supported input.
- **Branch-aware polling** — `WorkflowDispatchResult` carries the dispatch
  branch (`fs-forge/<Kind>-<name>`) so `waitForWorkflow` queries the correct
  branch. Using `getDefaultBranch()` would silently fail because the GitHub
  API's `branch` filter matches `head_branch`, which is the dispatch ref.
- **Deterministic matching** — UUID uniqueness guarantees the CLI finds its
  own run, even if multiple users dispatch for the same claim name (concurrency
  is serialised by the workflow's `cancel-in-progress` group, but the UUID
  still ensures no cross-talk).
- **Polling cost** — each 5-second poll is one API call. A 20-minute wait is
  ~240 calls, well within the 5,000/hour authenticated user rate limit.
- **UUID generation** — requires `crypto.randomUUID()` (Node 19+, already
  available in the CLI's runtime).

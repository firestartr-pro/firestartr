---
name: rollout-functionality
description: Test a branch, issue or release on a pre org before rollout by deploying snapshots and exercising the change through the claims system.
disable-model-invocation: true
---

# rollout-functionality

One run is one **sweep**: pre-rollout → assess → test → verify → cleanup →
report. Name every test resource `sweep-<short-hash>-…` (hash of input and
time).

1. **Pre-rollout.** Always deploy both snapshots to the target org, whatever
   changed: `publish-cli-snapshot-on-pre` and `deploy-snapshot-on-pre`. If
   either fails, abort and report. If the diff touches CRDs, warn the user now,
   in the report and in the issue: CRD changes need manual settlement.
2. **Assess.** Resolve the input to a diff: a branch (`git diff main...<branch>`),
   an issue (its linked branch or PR; with none, report "no changes" and exit)
   or a release (`git diff <previous-tag>..<tag>`). Read it and build
   scenarios: CRUD for new claim fields, trigger-and-verify for behavior or
   operator changes, reproduce-then-verify for bug fixes. Pick the wet repos
   involved: `state-github`, `state-infra`, `state-secrets`.
3. **Test.** Run scenarios one at a time, normal CRUD first, then fringe cases
   (idempotency, invalid input, whatever the diff suggests). Always go through
   the `firestartr-operation` skill, never `fs-forge-cli` or the cluster
   directly.
4. **Verify.** Poll the apply or deletion check runs (not plan) on the wet-repo
   PRs with `gh`, for up to 10 minutes (or `--timeout`). If you can't read
   them, ask the user. Each scenario ends PASS, FAIL or TIMEOUT.
5. **Cleanup.** Delete every `sweep-<hash>-` resource through
   `firestartr-operation`; list anything that fails for manual cleanup.
6. **Report.** Open an issue in `<org>/claims` with: input, org, status
   (HEALTHY, BROKEN or TIMEOUT), both snapshots, CRD warnings, each scenario's
   result and details, check runs per wet repo, cleanup, and only the failing
   output. Print the status and the issue URL.

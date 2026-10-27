# Plan mode is read-only and lock-free

Platform operators need to see what the operator *would* do to every CR (to
validate a candidate version, or to audit drift) without letting it do it, and
without disturbing the live operator running on the same cluster.

## Decision

1. **Read-only by a write gateway.** Every cluster and GitHub write (finalizers,
   initial and regular status, high-priority status, TFResults, connection and
   output secrets, check runs, commit statuses, PR comments) first calls
   `assertWriteAllowed`. In Plan mode it throws `PlanModeWriteError`, so a missed
   write path fails loudly in tests. Plan mode skips the leader-election Lease,
   like `OPERATOR_IGNORE_LEASE`. The guarantee is enforced in code only; no
   read-only credentials or RBAC profile are required.
2. **Lock-free plans.** Every Terraform plan in Plan mode runs with
   `-lock=false`, so a shadow plan never blocks or fails a live apply. Each
   artifact says `Lock: none`: the plan is advisory and may read state in the
   middle of a live apply; the next plan corrects it.
3. **The operation comes from the live status.** The informer still reads the
   status, finalizers and `deletionTimestamp` written by the live operator to
   choose CREATED, UPDATED, MARKED_TO_DELETION or NOTHING, but never writes them.
   Policies filter operations exactly as in the live handlers; a blocked
   operation gives a `SKIPPED (policy <name> blocks <op>)` artifact. Retry state
   is kept in memory only.
4. **A missing parent gives SKIPPED, not a stuck CR.** When a parent's outputs
   are not available, the CR gets `SKIPPED (parent <kind>/<name> not
   provisioned)` instead of waiting forever. Planning with Terraform "unknown"
   values for missing outputs is not attempted.
5. **One plan, two renderings.** terraform_provisioner plans once into a plan
   file and renders it with `show` (text) and `show -json`; both handlers use it.

## Consequences

- A Plan mode operator can run next to a live one as a shadow or a drift
  auditor; neither interferes with the other.
- Plan mode adds provider API calls (including GitHub rate-limit usage) on top
  of the live operator; narrow the watched kinds or namespace if that matters.
- Kinds without a Terraform plan (the dev dummies) get a SKIPPED artifact.
- Plan mode cannot be switched on or off in a running process.

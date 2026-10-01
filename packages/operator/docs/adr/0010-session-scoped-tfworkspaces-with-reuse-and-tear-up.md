# Session-scoped Terraform workspaces with reuse and tear-up

The `tfworkspaces` processor isolates each `FirestartrTerraformWorkspace` execution in a
per-run local project directory `/tmp/tfworkspaces/<kind>-<name>-<sessionId>`,
where `sessionId` is a short random id generated once per operation. Within an
apply operation the `apply` command prepares the workspace and the follow-up
`output` command reuses it (`reuseExistingProject: true`) instead of rebuilding
and re-initialising the project; the workspace is removed at the end via the
`tear-up-project` command in a `finally` block. This replaces the previous
unconditional `clearLocalTfProject()` that wiped a single shared
`tfStateKey`-named directory at the top of every operation. Tear-up runs only if
Terraform execution actually started, and its failures are logged, never fatal —
the workspace is ephemeral and a successful apply must stand.

We chose this over keeping the shared clear-local path because that path paid for
two full workspace rebuilds per apply (`apply` then `output`) and let overlapping
runs for the same key destroy each other's directory. Session-scoping is
surprising in three ways a future reader will question: the local project path is
now random per run, `apply` and `output` deliberately diverge on the reuse flag,
and `clearLocalTfProject()` was removed — the plan flow also uses session-scoped
paths with tear-up instead. `CREATED` operations still go through the policy gate
and may route to observe/plan when policy is `observe`/`observe-only`; session
scoping only changes the local project dir. The reuse and
`tear-up-project` capabilities live in the shared `terraform_provisioner` package
(added in PR #2066, already adopted by `gh_provisioner`); the operator only opts
in. Crucially, only the **local** project location changed — `tfStatePath` and
backend state addressing are untouched, so session isolation never affects which
remote state a run reads or writes.

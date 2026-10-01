# e2e

End-to-end suites that validate reconciled Firestartr resources against real
GitHub and a live operator. This glossary covers the suite vocabulary; other
areas are authored lazily via `/domain-modeling` as the package is touched.

## Language

**Resource validation**:
e2e's job: asserting reconciled resource state, as opposed to environment
orchestration.
_Avoid_: testing, checking

**Massive suite**:
The opt-in large-scale create/delete scenario, excluded from normal and
push-triggered runs due to GitHub API rate limits.
_Avoid_: stress test, load test

**Lifecycle view**:
The created/deleted resource timeline surfaced in e2e diagnostics and the GitHub
Actions summary.
_Avoid_: timeline, history

**DLH**:
The operator's "Uncontrolled error (DLH)" failure state; e2e surfaces its context
when a CR lands in it. (Owned by the operator context; referenced here.)
_Avoid_: dead letter

**Org settings singleton**:
There is exactly one org settings resource per GitHub org, so e2e "create" and
"delete" are apply/destroy of that one singleton, not of distinct objects; they
run as a single serialized lifecycle. (Singleton rule owned by the cdk8s_renderer
context; referenced here.)
_Avoid_: create/delete a settings object

**Disposable e2e org**:
`firestartr-e2e` exists only for these suites, so its org settings can be applied
and destroyed freely — no snapshot/restore of prior settings is needed.
_Avoid_: shared org, production org

**Repo-secrets machinery**:
The `GHRepositorySecretsSection` → GitHub repository secret path: a referenced
plain Secret's plaintext is encrypted and provisioned as a repo `actions` secret.
e2e mimics the ExternalSecrets output with a plain Secret rather than running
ExternalSecrets. (Provisioning owned by the gh_provisioner context; referenced
here.)
_Avoid_: ExternalSecrets flow, secret sync

**Existence verification**:
Metadata-only repo-secret signal: the secret is confirmed by name, and after
rotation its `updated_at` timestamp must strictly advance. Diagnostic/readiness
only — never proof of the value, since GitHub never returns a secret's value.
_Avoid_: value check, decrypt check

**Value verification**:
e2e's authoritative repo-secret assertion: a `workflow_dispatch` workflow
committed into the disposable repository compares the provisioned Actions
secret with the expected plaintext, and the run's `success` conclusion proves
byte-for-byte equality. Runs are correlated by a unique id surfaced as the
run's `display_title`; the newest run is never assumed to be the test's run.
_Avoid_: log scraping, latest-run assumption

**Force-reconcile**:
Setting the `firestartr.dev/reconcile-at` annotation to make the operator
re-provision a CR whose spec is unchanged. e2e uses it to push a rotated secret,
since changing the referenced Secret alone does not re-provision.
_Avoid_: refresh, retrigger

**Org variable section**:
The `FirestartrGithubOrganizationVariableSection` CR rendered from an
`OrgSettingsClaim.providers.github.actions_variables` block. It reconciles
GitHub Actions organization variables independently of the org-settings CR.
_Avoid_: org variables CR, actions variables CR

**Apply-time adoption (org variables)**:
When a variable name declared in the claim already exists on the GitHub org,
the gh_provisioner entity imports it into Terraform state during `loadResources(apply)`
so the CR-declared value overwrites the external one. The e2e suite asserts this
on the first reconciliation by pre-creating the variable before applying the CR.
_Avoid_: import, manual import

**Run-prefixed org-scoped name**:
An org-level resource name that embeds the test-run prefix (e.g.
`${prefix}-e2e-all`) to avoid collisions across parallel or reran e2e jobs,
since GitHub org variables are global to the org.
_Avoid_: unique name, prefixed name

**Diagnostic file**:
A YAML snapshot of operator internal state (`/tmp/diagnostic` inside the pod),
overwritten every 10s. The e2e global collector reads it periodically via
`kubectl exec` and appends timestamped snapshots to `/tmp/diagnosis` on the host,
building a human-readable flight recorder of queue, slot, semaphore, and error
state across the entire suite run. Disabled by `DISABLE_DIAGNOSTIC_FILE` (operator
side) or `DISABLE_DIAGNOSTIC_COLLECTOR` (e2e side).
_Avoid_: metrics, telemetry

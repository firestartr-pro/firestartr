# Repo-secrets e2e verifies by existence + `updated_at`, and drives updates with `reconcile-at`

> Superseded by
> [0003-repo-secrets-e2e-verifies-value-via-actions-workflow](./0003-repo-secrets-e2e-verifies-value-via-actions-workflow.md)
> for the value assertion; kept as history. Its `reconcile-at` and
> ExternalSecrets-mimicry observations still apply.

The e2e suite for the repo-level secrets machinery
(`GHRepositorySecretsSection` → GitHub Actions repo secret) mimics the
ExternalSecrets output with a plain Kubernetes `Secret` (via
`createTempOpaqueSecret`) instead of running the ExternalSecrets machinery,
because the e2e environment has no real secret store.

Because the GitHub API never returns a repo secret's value, "provisioned
correctly" is asserted as **existence by name** (`GET .../actions/secrets/{NAME}`
returns the expected name), and "updated correctly" is asserted as the secret's
**`updated_at` timestamp strictly advancing** after the plaintext changes — the
only real-GitHub-state signals available.

Changing the referenced `Secret` alone does **not** re-provision the
`GHRepositorySecretsSection` (the operator only re-provisions on CREATED, a
bumped spec `generation`, or a newer `firestartr.dev/reconcile-at` annotation).
The test therefore mutates the plaintext and then forces re-provisioning via the
`reconcile-at` annotation. This same gap exists in production: a rotated k8s
Secret has no automatic path to re-push the repo secret — an observation this
test documents rather than fixes.

Scope is deliberately narrowed to the `actions` section only; `codespaces` and
`dependabot` share the same provisioning code path and add API/org-plan surface
for near-zero extra coverage.

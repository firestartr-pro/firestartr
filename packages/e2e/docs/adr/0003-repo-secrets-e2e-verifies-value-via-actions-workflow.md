# Repo-secrets e2e verifies the exact secret value via an in-repo Actions workflow

> Supersedes
> [0002-repo-secrets-e2e-verifies-by-existence-and-updated-at](./0002-repo-secrets-e2e-verifies-by-existence-and-updated-at.md),
> which is preserved as history. 0002's observations about the `reconcile-at`
> re-provisioning gap and the plain-`Secret` ExternalSecrets mimicry still
> stand; what changes is the strength of the value assertion.

Existence by name and an advancing `updated_at` prove that *a* secret was
provisioned and re-provisioned, but never that its *value* is the plaintext the
test provided — the GitHub API never returns a secret's value. The repo-secrets
e2e now asserts the value authoritatively from inside the disposable generated
repository: the test commits a `workflow_dispatch` workflow
(`packages/e2e/fixtures/workflows/verify-secret.yaml` →
`.github/workflows/verify-secret.yaml`), dispatches it with the secret name,
the expected plaintext, and a unique correlation id, and treats the run's
`success` conclusion as the authoritative byte-for-byte equality assertion.
The workflow compares values through environment variables in a small Node
expression and never prints them.

Because the repository and its secret are disposable test data, the expected
plaintext travels as an ordinary `workflow_dispatch` input. The secret's name
and `updated_at` metadata checks remain as diagnostics, and `updated_at`
polling after rotation is kept only as a readiness signal before the second
verification dispatch — it is no longer the update proof.

Key mechanics, settled so the test cannot lie about which run it observed:

- The workflow's `run-name` is the correlation id, so polling selects the run
  whose `display_title` exactly matches; the newest run is never assumed to be
  this test's run.
- The workflow file is committed once — after repository provisioning, before
  the initial value check — directly to the admin-protected `main` branch.
  The test disables admin enforcement on its rendered repository CR via the
  existing feature-repo bypass, scoped to this disposable repository only.
- After committing, the test polls until the workflow is discoverable, then
  dispatches exactly once. Failed or timed-out runs fail the test with the
  run id and URL; they are never redispatched automatically, and logs are not
  downloaded.
- Each dispatched run gets a five-minute budget (correlation polling plus
  completion), and the test's Jest timeout grows by ten minutes beyond the
  standard render/apply timeout to cover both the initial and rotation
  verifications.

The GitHub App installation's workflow-file write and Actions dispatch/read
permissions are environment prerequisites: native permission errors surface
directly, with no preflight check or fallback path.

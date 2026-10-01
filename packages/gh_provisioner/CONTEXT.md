# gh_provisioner

Provisions GitHub resources from Firestartr CRs by driving Terraform modules,
organized as per-kind entities. This glossary covers the entity and workspace
model; other areas are authored lazily via `/domain-modeling` as the package is
touched.

## Language

**Entity**:
A gh_provisioner unit (e.g. `ghrepo`) that reconciles one Firestartr CR kind into
GitHub via Terraform.
_Avoid_: resource, handler

**Workspace session**:
One caller-owned, preserved Terraform workspace shared across all
`runOnTerraform` calls of a single `runGhProvisioner` run, keyed
`<kind>-<crName>-<sessionId>`.
_Avoid_: run, context

**CODEOWNERS slug substitution**:
Replacing group external-name Owners with group-slug Owners before provisioning
`.github/CODEOWNERS`.
_Avoid_: rewrite, mapping

**Secret staleness**:
A condition where a GitHub secret's value on the live repo differs from the
value declared in the CR, because `ignoreChanges` / `ignore_changes` on the
encrypted value field prevents Terraform from detecting or applying the update.
The gh-provisioner encrypts the plaintext secret and embeds the ciphertext in
the config; the tfm module's `lifecycle.ignore_changes` then silently discards
the change during plan/apply, causing the old value to persist.

**Encrypted value non-determinism**:
The property that encrypting the same plaintext with the same key produces
different ciphertext each time (due to encryption nonces or initialization
vectors). This means Terraform always detects a diff on `encrypted_value` /
`value_encrypted` even when the underlying secret hasn't changed — which was
the original motivation for adding `ignore_changes`. Because of it, the change
signal cannot be the ciphertext; it must be a deterministic fingerprint of the
plaintext (see **Plaintext fingerprint**).

**Plaintext fingerprint**:
The SHA-256 hex digest of a secret's plaintext value, emitted by the
gh-provisioner into the config under `<section>_sha256/<secretName>` alongside
the ciphertext. Because the digest is deterministic, it changes only when the
plaintext actually changes, so the tfm module uses it (via `terraform_data` +
`replace_triggered_by`) as the authoritative secret change detector while the
ciphertext stays under `ignore_changes`. The plaintext itself never enters the
config or Terraform state. The gh-provisioner always emits the three section
maps (`actions_sha256`, `codespaces_sha256`, `dependabot_sha256`), empty when a
section has no secrets.
_Avoid_: hash, checksum, sha

**Installed managed files**:
The accumulated list of user-managed file addresses (`"<file>/<branch>"`) that have been provisioned at least once by a `FirestartrGithubRepositoryFeature`. Carried as both a TFM input variable (to exclude already-provisioned files from the Terraform config) and a TFM output (to persist the list across reconciliations). Prevents Terraform from overwriting or deleting user edits on subsequent applies or feature upgrades.
_Avoid_: tracked files, user-managed list

**Migration reimport**:
The one-time `import-with-reimport` operation that must be triggered on all `FirestartrGithubRepositoryFeature` entities when upgrading from pre-tracking code (no `installed_managed_files` output) to the tracking version. Destroys legacy TF state and reimports only non-user-managed files; the subsequent operator reconciliation (regular apply) completes the migration by seeding the `installed_managed_files` output via the provision-once path.
_Avoid_: rehydration, state reset

**Apply-time adoption**:
Adopting GitHub resources that already exist on the live repo (found via a read
during `loadResources`, e.g. manually-created repo labels) into Terraform state
during a normal `apply`, by writing the recorded import entries as import blocks
and running the single apply with import mode. The import check is narrowed by
**Managed labels**, which limits the GitHub API read to only labels that are new
to the module. Distinct from the explicit `import` command (full adoption of a
pre-existing resource set) and from **Migration reimport** (the one-time
legacy-state cleanup for features).
_Avoid_: pre-apply import, import-then-apply

**Managed labels**:
The list of label names output by the TFM `github-repo` module on each run,
persisted across reconciliations via the Kubernetes outputs Secret. On the next
reconciliation, the gh-provisioner reads `managed_labels` via self-outputs and
computes `new_to_module = declared_labels - managed_labels`. Only new-to-module
labels trigger the GitHub existence check and import block generation; labels
already in `managed_labels` are handled natively by Terraform. A read-only
accumulator — unlike `installed_managed_files`, it is never written back as a
TFM input. Accepts `undefined` (pre-fix secrets) or `[]` (no previously managed
labels) as "all labels are new_to_module."
_Avoid_: previous labels, known labels

**Managed variables**:
The list of variable names output by the TFM `github-org-variable-section` module
on each run, persisted across reconciliations via the Kubernetes outputs Secret.
On the next reconciliation, the gh-provisioner reads `managed_variables` via
self-outputs and computes `new_to_module = declared_variables - managed_variables`.
Only new-to-module variables trigger the GitHub existence check and import block
generation; variables already in `managed_variables` are handled natively by
Terraform. Treats `undefined` or `[]` as "no previously managed variables."
_Avoid_: previous variables, known variables

> Auth uses **Profile** / `withProfile` — defined in the `github` context,
> referenced here.

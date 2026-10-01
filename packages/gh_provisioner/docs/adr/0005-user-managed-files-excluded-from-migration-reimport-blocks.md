# User-managed files are excluded from migration reimport import blocks

When upgrading from pre-tracking code (no `installed_managed_files` output) to
the tracking version, all `FirestartrGithubRepositoryFeature` entities must go
through an `import-with-reimport` cycle to clean up legacy TF state. During
that cycle, `loadAddressesToImport()` generates import blocks **only for
non-user-managed files**. User-managed files receive no import block.

Instead, the addresses of all `userManaged: true` files declared in the current
CR spec are written directly into the `installed_managed_files` input variable
in the entity document. This seeds the TFM input so the output is computable on
the next apply, without ever placing those files in Terraform state during the
migration.

The alternative — importing user-managed files into state and immediately
state-rm'ing them in `postProvision` — would achieve a fully-populated
`installed_managed_files` output in a single cycle but adds an extra failure
mode: if the post-reimport state rm fails, the files remain in state and
Terraform manages them as if they were ordinary files, defeating the
provision-once guarantee. The two-cycle approach (reimport + next regular
apply) is safer: the operator's natural reconciliation loop handles the second
cycle, and the provision-once path in `provisionManagedFiles` already handles
the "first-ever apply with empty output" case correctly.

**Considered option**: add an explicit apply step inside `runOnTerraform`'s
`import-with-reimport` branch so the output is committed in one shot. Rejected
because it couples state-import and apply semantics inside the bridge, which
have separate risk surfaces and should remain independently observable.

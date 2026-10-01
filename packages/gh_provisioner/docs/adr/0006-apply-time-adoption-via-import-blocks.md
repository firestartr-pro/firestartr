# Apply-time adoption of existing GitHub resources via import blocks

A `FirestartrGithubRepository` that declares labels which already exist on GitHub
(created manually or by another tool) used to fail reconciliation with a GitHub
422 `already_exists` error, because the TFM module tries to `POST` a label that
is already there. The TFM module has no "upsert" operation for labels, so
Terraform must either create or update the label — never "adopt" it.

The fix makes a normal `apply` consume the pending import entries that the
entity already records during `loadResources`: `provisionLabels` queries the
live repo for its labels and, for each declared label that already exists, adds
a `github_issue_label` import entry to the entity's import document. When an
`apply` runs and the import document is non-empty, the bridge runs the regular
`apply` with `importMode=true`, so the import entries are written to
`imports.tf` as Terraform `import {}` blocks and consumed by that same single
apply. Import blocks are idempotent: resources already in Terraform state are
skipped silently, so the apply imports the pre-existing labels into state and
reconciles them (updating color/description if the declared value drifts).

This "apply-time adoption" is deliberately generic in the bridge: it fires for
any entity that carries pending import entries at apply time, not only labels.
The only entity that currently records imports during a normal `loadResources`
is the ghrepo labels path; all other entities only record imports inside
`loadAddressesToImport()`, which runs on the explicit `import` /
`import-with-reimport` commands. There is no plan step for gh repos (the
operator applies directly), so no plan/apply mismatch is introduced.

The `provisionLabels` import check is further narrowed by the `managed_labels`
accumulator (ADR 0007): only labels that are new to the TFM module
(`new_to_module = declared_labels - managed_labels`) trigger the GitHub
existence check and import block generation. Labels already in
`managed_labels` are handled natively by Terraform state.

**Alternative considered**: run a `custom-import` step (an apply executed with
`importMode=true`) and then a second, regular apply on the reused workspace.
Rejected: the second apply is redundant work — the import-mode apply already
reconciles the full configuration — and doubles Terraform execution time on
every label-bearing apply.

**Alternative considered**: run `custom-import` alone and return early. Rejected:
`custom-import` invokes `apply` without the caller's control handle
(`opts.ctl`), so the apply would no longer be cancellable or bounded by the
operator's hard timeout. Running the regular `apply` with `importMode=true`
keeps the import blocks and the control handle in a single step.

**Considered option**: gate the import read to "first apply only" or "only when
labels are not yet in state". Rejected: detecting state membership requires an
extra state read. ADR 0007 now provides a cleaner narrowing mechanism: the
`managed_labels` accumulator avoids the GitHub API read for labels that were
already managed by the module on the previous run.

# Managed labels self-output accumulator narrows import checks to new-to-module labels

The `provisionLabels` path in `EntityGHRepo` must detect whether declared labels
already exist on GitHub (created manually or by another tool) so it can
API-normalize them and generate Terraform import blocks before apply. On the
first implementation, this check ran for every declared label on every reconcile,
burning one `getRepoIssuesLabels` API call per apply regardless of whether Terraform
already managed all labels.

This ADR introduces the `managed_labels` accumulator — a TFM module output that
carries the label names managed on the previous run. On each reconciliation, the
gh-provisioner reads this output via `selfOutputs.getOutput('managed_labels')`
and computes `new_to_module = declared_labels - managed_labels`. Only
`new_to_module` labels trigger the GitHub existence check and import block
generation. Labels already in `managed_labels` are handled natively by Terraform:
in state → update drift, not in state → recreate.

The accumulator follows the same self-output cycle as `installed_managed_files`
(issue #2296, ADR 0005), with one difference: `managed_labels` is read-only — the
gh-provisioner never writes it back as a TFM input. The TFM module always derives
the output from `var.config.labels`, so the cycle is purely:

```
TFM outputs managed_labels → stored in Kubernetes Secret →
  gh-provisioner reads via selfOutputs → diffs → provisions
```

**Alternative considered**: check all declared labels against GitHub on every
reconcile. Rejected: after the first import, Terraform already owns the labels,
and the `getRepoIssuesLabels` call is pure waste. The `managed_labels`
accumulator eliminates this API call for labels the module already manages.

**Alternative considered**: write `managed_labels` back as a TFM input (like
`installed_managed_files`). Unnecessary: the TFM module doesn't use it for
filtering or logic. The output is self-consistent because it's derived from
`var.config.labels`, which reflects the full declared set.

**Backwards compatibility**: `managed_labels` accepts both `undefined` (pre-fix
output secrets — the key is absent from the outputs Secret) and `[]` (no
previously managed labels). Both collapse to "all declared labels are
new_to_module," preserving the full check on the first run after the fix.

# Org-variables e2e asserts apply-time adoption on first reconciliation

Issue #2536's acceptance criteria describe apply-time adoption as a single
reconciliation: *"pre-create a variable on the GitHub org outside the system ...
then apply a CR that declares the same variable name. Verify the entity imports
it and the CR's declared value overwrites the externally-created value."*

Although #2542's design text originally suggested skipping adoption when no
previous `managed_variables` output exists, the implemented entity
(`packages/gh_provisioner/src/entities/ghorgvarsection/index.ts`) treats every
declared variable as "new to module" on the first reconciliation and checks
GitHub for each one. If a variable already exists, it generates an import block.

The e2e test therefore uses a single apply:

1. Pre-create an external GitHub Actions org variable with a run-prefixed name.
2. Render and apply an `OrgSettingsClaim` that declares the same variable name
   with a different value.
3. Assert that the gh_provisioner entity discovers the external variable,
   imports it, and the CR value wins by running a `workflow_dispatch` workflow
   in a disposable repository that compares `vars.<name>` with the expected value.

This matches both the issue acceptance criteria and the actual code behavior.

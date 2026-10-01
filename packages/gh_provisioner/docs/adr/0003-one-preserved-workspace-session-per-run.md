# One preserved Terraform workspace session per gh_provisioner run

A single `runGhProvisioner(...)` execution makes several `runOnTerraform(...)`
calls; these share one caller-owned, preserved Terraform Workspace session
instead of rebuilding the project per call. The local workspace identity is
CR-based and uniform for every resource: `<kind>-<crName>-<sessionId>`, using the
Kubernetes CR `metadata.name` as the uniqueness boundary plus a per-run session
id. Workspace reuse must tolerate entities that still expose import/reimport
annotations: follow-up commands such as `output` must not force
`terraform_provisioner` reuse validation to require `imports.tf` when the current
command no longer needs import scaffolding.

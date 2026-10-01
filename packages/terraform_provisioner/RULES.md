# terraform_provisioner — Package Rules

- Only two project flavors exist: `tf_project` (`Inline`, `TFProjectManager`)
  and `tf_project_remote` (`Remote`, `TFProjectManagerRemote`). New behavior
  goes into one of these managers or a utility they call; a new flavor needs
  an explicit architecture decision.
- Managers orchestrate; every generated workspace file comes from a
  `writer_*.ts` writer.
- All `tofu` execution goes through `tfExec` in `src/utils.ts`, with timeouts
  and termination in `src/process_handler.ts`. No other `spawn('tofu', ...)`.
- Reference (`${{ references.* }}`) and `secret-ref-*` resolution lives only in
  `src/resolutor/`; structured plan parsing lives only in `src/tf/`.
- Additional-file writes must keep the path-boundary protections: nothing may
  be written outside the project directory.
- `runTerraformProvisioner(...)` is called by `operator`, and its context
  follows the `FirestartrTerraformWorkspace` CRD in `k8s`. Change all three
  together.
- No claim rendering, Kubernetes reconciliation or provider-specific domain
  logic here.

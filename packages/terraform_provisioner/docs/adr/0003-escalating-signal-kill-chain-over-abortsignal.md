# Escalating signal kill chain over AbortSignal cancellation

Child OpenTofu/Terraform processes are terminated by a custom escalating kill chain
in `process_handler.ts` (`hardTimeout -> SIGINT -> 120s -> SIGTERM -> 10s -> SIGKILL`),
driven by a per-operation timeout and a `ProcessHandler` callback contract threaded
through `tfExec`, the project managers, and `runTerraformProvisioner`, rather than by
Node's native `spawn(..., { signal })` `AbortSignal` cancellation. The staged
escalation exists because Tofu needs an initial SIGINT plus a generous grace window
to release state locks and unwind its current operation cleanly; a single blunt kill
would risk corrupting or orphaning Terraform state. The trade-off: callers (notably
the operator) cannot cancel an in-flight operation via a standard `AbortSignal` and
instead rely on the per-operation `hardTimeout` and, ultimately, Kubernetes SIGKILL
as the hard backstop on shutdown. This is the provisioner-side counterpart to the
operator's decision recorded in `packages/operator/docs/adr/0006`.

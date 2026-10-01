# Parent-identity dependency check over timer-based creation block

To guarantee a parent CR is processed before its children on near-simultaneous
creation, the operator uses a parent-identity check (`hasActiveParent` in
`pickEligible`) that skips a CREATED child while its specific parent is still
PENDING or being processed, instead of the previous timer-based block
(`applyCreationBlock` / `CREATION_BLOCK_DURATION_MS`, now removed). The timer
was unsound with multiple slots: it expired independently of whether the
specific parent had finished, so a second slot could dispatch a child while its
parent was still picked. The check reads `spec.repositoryTarget.ref` (GitHub
kinds) or `spec.needs` (dummy chain) to identify the parent, and precomputes a
`Set` of active parent keys once per selection pass to keep selection O(n). The
trade-off: a small amount of per-kind parent-lookup knowledge in the scheduler,
in exchange for correct ordering under concurrency.
